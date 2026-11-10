"""Hypothesis strategies for workflows and patches."""

from __future__ import annotations

from hypothesis import strategies as st

from app.domain.patches import (
    AddCriterion,
    AddQuizQuestion,
    CriterionFields,
    EditInterviewPrompt,
    RemoveCriterion,
    RemoveQuizQuestion,
    ReplaceQuizQuestion,
    SetCutoff,
    SetInterviewThemes,
    SetNotify,
    SetPassMark,
    SetTimeLimit,
    SetTurnCap,
    ToggleNode,
    UpdateCriterion,
    UpdateInterviewRubric,
)
from app.domain.workflow import (
    Criterion,
    FinalConfig,
    FinalNode,
    InterviewConfig,
    InterviewNode,
    QuizConfig,
    QuizNode,
    QuizQuestion,
    RubricItem,
    ScreeningConfig,
    ScreeningNode,
    Workflow,
    chain,
)

ids = st.text("abcdefghij0123456789", min_size=1, max_size=4)
names = st.text("abcdefghijklmnopqrstuvwxyz ", min_size=1, max_size=20).map(str.strip).filter(bool)
percent = st.integers(0, 100)
weight = st.integers(1, 5)


@st.composite
def criteria(draw, min_size=1, max_size=6):
    cid = draw(st.lists(ids, min_size=min_size, max_size=max_size, unique=True))
    return [Criterion(id=i, name=draw(names), weight=draw(weight), must_have=draw(st.booleans())) for i in cid]


@st.composite
def question(draw, qid=None):
    opts = draw(st.lists(names, min_size=3, max_size=5, unique_by=str.lower))
    return QuizQuestion(id=qid or draw(ids), prompt=draw(names) + "?", options=opts,
                        answer_index=draw(st.integers(0, len(opts) - 1)),
                        difficulty=draw(st.sampled_from(["easy", "medium", "hard"])))


@st.composite
def questions(draw, max_size=5):
    qids = draw(st.lists(ids, max_size=max_size, unique=True))
    qs, seen = [], set()
    for q in qids:
        item = draw(question(qid=q))
        key = item.prompt.lower().rstrip("?").strip()
        if key not in seen:
            seen.add(key)
            qs.append(item)
    return qs


@st.composite
def rubric(draw):
    rids = draw(st.lists(ids, max_size=4, unique=True))
    return [RubricItem(id=r, name=draw(names), weight=draw(weight)) for r in rids]


@st.composite
def workflows(draw) -> Workflow:
    nodes = [ScreeningNode(type="screening", id="s", config=ScreeningConfig(cutoff=draw(percent),
                                                                              criteria=draw(criteria())))]
    if draw(st.booleans()):
        nodes.append(QuizNode(type="quiz", id="q", enabled=draw(st.booleans()),
                              config=QuizConfig(pass_mark=draw(percent), questions=draw(questions()))))
    if draw(st.booleans()):
        nodes.append(InterviewNode(type="interview", id="i", enabled=draw(st.booleans()),
                                   config=InterviewConfig(turn_cap=draw(st.integers(3, 10)), rubric=draw(rubric()))))
    nodes.append(FinalNode(type="final", id="f", config=FinalConfig(notify_on_complete=draw(st.booleans()))))
    return chain(nodes)


# Node ids include ones that may not exist, so invalid patches are generated too.
node_ids = st.sampled_from(["s", "q", "i", "f", "missing"])
crit_ids = st.one_of(ids, st.just("c0"))


def patches():
    return st.one_of(
        st.builds(SetCutoff, op=st.just("set_cutoff"), node=node_ids, value=percent),
        st.builds(SetPassMark, op=st.just("set_pass_mark"), node=node_ids, value=percent),
        st.builds(SetTimeLimit, op=st.just("set_time_limit"), node=node_ids, value=st.integers(5, 120)),
        st.builds(AddCriterion, op=st.just("add_criterion"), node=node_ids,
                  criterion=st.builds(Criterion, id=crit_ids, name=names, weight=weight, must_have=st.booleans())),
        st.builds(UpdateCriterion, op=st.just("update_criterion"), node=node_ids, criterion_id=crit_ids,
                  fields=st.builds(CriterionFields, name=st.none() | names, weight=st.none() | weight,
                                   must_have=st.none() | st.booleans())),
        st.builds(RemoveCriterion, op=st.just("remove_criterion"), node=node_ids, criterion_id=crit_ids),
        st.builds(AddQuizQuestion, op=st.just("add_quiz_question"), node=node_ids, question=question()),
        st.builds(ReplaceQuizQuestion, op=st.just("replace_quiz_question"), node=node_ids, question_id=ids,
                  question=question()),
        st.builds(RemoveQuizQuestion, op=st.just("remove_quiz_question"), node=node_ids, question_id=ids),
        st.builds(EditInterviewPrompt, op=st.just("edit_interview_prompt"), node=node_ids,
                  prompt_additions=st.text(max_size=50)),
        st.builds(SetInterviewThemes, op=st.just("set_interview_themes"), node=node_ids,
                  themes=st.lists(names, max_size=3)),
        st.builds(UpdateInterviewRubric, op=st.just("update_interview_rubric"), node=node_ids, rubric=rubric()),
        st.builds(SetTurnCap, op=st.just("set_turn_cap"), node=node_ids, value=st.integers(3, 10)),
        st.builds(ToggleNode, op=st.just("toggle_node"), node=node_ids, enabled=st.booleans()),
        st.builds(SetNotify, op=st.just("set_notify"), value=st.booleans()),
    )


@st.composite
def patch_for(draw, wf: Workflow):
    """A patch aimed at this workflow: usually at nodes and items that exist (so it can
    apply), sometimes at missing ones (so rejections are exercised too)."""
    by_type = {n.type: n for n in wf.nodes}

    def node(*types):
        present = [by_type[t].id for t in types if t in by_type]
        return draw(st.sampled_from(present)) if present and draw(st.integers(0, 9)) else draw(node_ids)

    def existing(items):
        known = [i.id for i in items]
        return draw(st.sampled_from(known)) if known and draw(st.integers(0, 9)) else draw(ids)

    crits = by_type["screening"].config.criteria
    qs = by_type["quiz"].config.questions if "quiz" in by_type else []
    kind = draw(st.integers(0, 14))
    match kind:
        case 0:
            return SetCutoff(op="set_cutoff", node=node("screening"), value=draw(percent))
        case 1:
            return SetPassMark(op="set_pass_mark", node=node("quiz", "interview"), value=draw(percent))
        case 2:
            return SetTimeLimit(op="set_time_limit", node=node("quiz"), value=draw(st.integers(5, 120)))
        case 3:
            return AddCriterion(op="add_criterion", node=node("screening"),
                                criterion=Criterion(id=draw(ids), name=draw(names), weight=draw(weight)))
        case 4:
            return UpdateCriterion(op="update_criterion", node=node("screening"), criterion_id=existing(crits),
                                   fields=CriterionFields(name=draw(st.none() | names), weight=draw(weight)))
        case 5:
            return RemoveCriterion(op="remove_criterion", node=node("screening"), criterion_id=existing(crits))
        case 6:
            return AddQuizQuestion(op="add_quiz_question", node=node("quiz"), question=draw(question()))
        case 7:
            return ReplaceQuizQuestion(op="replace_quiz_question", node=node("quiz"), question_id=existing(qs),
                                       question=draw(question()))
        case 8:
            return RemoveQuizQuestion(op="remove_quiz_question", node=node("quiz"), question_id=existing(qs))
        case 9:
            return EditInterviewPrompt(op="edit_interview_prompt", node=node("interview"),
                                       prompt_additions=draw(st.text(max_size=50)))
        case 10:
            return SetInterviewThemes(op="set_interview_themes", node=node("interview"),
                                      themes=draw(st.lists(names, max_size=3)))
        case 11:
            return UpdateInterviewRubric(op="update_interview_rubric", node=node("interview"), rubric=draw(rubric()))
        case 12:
            return SetTurnCap(op="set_turn_cap", node=node("interview"), value=draw(st.integers(3, 10)))
        case 13:
            return ToggleNode(op="toggle_node", node=node("quiz", "interview"), enabled=draw(st.booleans()))
        case _:
            return SetNotify(op="set_notify", value=draw(st.booleans()))


@st.composite
def patch_sequences(draw, max_size=12):
    """A base workflow and a sequence of patches, each aimed at the workflow as it is when
    that patch is reached (rejected patches leave it unchanged)."""
    from app.domain.patches import PatchError, apply_patches

    base = draw(workflows())
    wf, seq = base, []
    for _ in range(draw(st.integers(0, max_size))):
        p = draw(patch_for(wf))
        seq.append(p)
        try:
            wf = apply_patches(wf, [p]).workflow
        except PatchError:
            pass
    return base, seq
