"""Jobs and the job-creation chat (backend plan §7.2)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints

from app.agents import common, jd_agent
from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES, AppError
from app.services import jobs as svc
from app.services import quiz as quiz_svc

router = APIRouter(prefix="/v1/manager/jobs", tags=["manager", "jobs"], responses=ERROR_RESPONSES)

Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatRequest(BaseModel):
    thread_id: UUID | None = None
    message: Message


class Created(BaseModel):
    job_id: UUID


@router.get("", response_model=list[svc.Job])
async def list_jobs(principal: PrincipalDep) -> list[svc.Job]:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.list_jobs(tx)


@router.post("/chat", response_model=jd_agent.JdChatState)
async def chat(body: ChatRequest, principal: PrincipalDep) -> jd_agent.JdChatState:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        if body.thread_id is None:
            thread_id = await common.new_thread(tx, user, "jd")
        else:
            thread = await common.own_thread(tx, user, body.thread_id, "jd")
            if thread["status"] != "open":
                raise AppError(409, "thread_closed", "This job was already created from this conversation.")
            thread_id = body.thread_id
            await tx.conn.execute("update agent_threads set updated_at = now() where thread_id = %s", (thread_id,))
        async with common.llm_errors(), common.checkpointer(tx) as saver:
            return await jd_agent.run_turn(saver, thread_id, body.message)


@router.get("/chat/{thread_id}", response_model=jd_agent.JdChatState)
async def get_chat(thread_id: UUID, principal: PrincipalDep) -> jd_agent.JdChatState:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        await common.own_thread(tx, user, thread_id, "jd")
        async with common.checkpointer(tx) as saver:
            return await jd_agent.load(saver, thread_id)


@router.post("/chat/{thread_id}/confirm", response_model=Created)
async def confirm(thread_id: UUID, principal: PrincipalDep) -> Created:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        thread = await common.own_thread(tx, user, thread_id, "jd")
        if thread["status"] != "open":
            raise AppError(409, "thread_closed", "This job was already created.", {"job_id": str(thread["job_id"])})
        async with common.checkpointer(tx) as saver:
            state = await jd_agent.load(saver, thread_id)
        if not state.complete or state.summary is None or state.workflow is None:
            raise AppError(409, "chat_incomplete", "Answer the remaining questions first.",
                           {"missing": state.missing})
        s = state.summary
        job_id = await svc.create_job(tx, user, title=s.title, description=s.description, location=s.location,
                                      seniority=s.seniority, workflow=state.workflow)
        await tx.conn.execute(
            "update agent_threads set status = 'confirmed', job_id = %s, updated_at = now() where thread_id = %s",
            (job_id, thread_id),
        )
        return Created(job_id=job_id)


@router.get("/{job_id}", response_model=svc.Job)
async def get_job(job_id: UUID, principal: PrincipalDep) -> svc.Job:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.get_job(tx, job_id)


@router.patch("/{job_id}", response_model=svc.Job)
async def update_job(job_id: UUID, body: svc.JobUpdate, principal: PrincipalDep) -> svc.Job:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.update_job(tx, job_id, body, user)


@router.post("/{job_id}/publish", response_model=svc.Published)
async def publish(job_id: UUID, principal: PrincipalDep) -> svc.Published:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.publish(tx, job_id, user)


# ------------------------------------------------------------------ quiz generation (§14)

@router.post("/{job_id}/quiz/generate", response_model=quiz_svc.GenerationQueued, status_code=202)
async def generate_quiz(job_id: UUID, body: quiz_svc.GenerateRequest,
                        principal: PrincipalDep) -> quiz_svc.GenerationQueued:
    """Generate quiz questions in the background. They are added to the workflow as a new version."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await quiz_svc.request_generation(tx, user, job_id, body)


@router.get("/{job_id}/quiz/generate/{run_id}", response_model=quiz_svc.GenerationStatus)
async def generation_status(job_id: UUID, run_id: UUID, principal: PrincipalDep) -> quiz_svc.GenerationStatus:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await quiz_svc.generation_status(tx, job_id, run_id)
