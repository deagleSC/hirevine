"""Instruction-like text in resumes (backend plan §13 step 3). Flags only: never blocks scoring."""

from __future__ import annotations

import re
from typing import TypedDict

PATTERNS: dict[str, re.Pattern[str]] = {
    "ignore_instructions": re.compile(
        r"\b(?:ignore|disregard|forget|override)\b.{0,30}\b(?:previous|prior|above|earlier|all|any|your)\b.{0,20}"
        r"\b(?:instructions?|prompts?|rules|directions|guidelines)\b", re.IGNORECASE),
    "score_manipulation": re.compile(
        r"\b(?:rank|rate|score|grade|mark|recommend|select|shortlist|hire)\b.{0,25}\b(?:this|the|me|him|her)\b.{0,20}"
        r"\b(?:candidate|applicant|resume|cv)?.{0,20}\b(?:highest|top|first|best|maximum|max|perfect|10/10|100%|4/4|"
        r"strong(?:ly)? (?:hire|yes))\b", re.IGNORECASE),
    "system_prompt": re.compile(
        r"\b(?:system prompt|developer message|you are (?:now )?(?:an?|the) (?:ai|assistant|model|language model|"
        r"recruiter|screener))\b", re.IGNORECASE),
    "role_marker": re.compile(
        r"(?:^\s*(?:system|assistant|user)\s*:|<\|im_start\|>|<\|im_end\|>|\[/?INST\]|<<SYS>>|###\s*(?:instruction|system)|"
        r"</?candidate_data>)", re.IGNORECASE),
    "ai_addressed": re.compile(
        r"\b(?:note|message|instructions?) (?:to|for) (?:the )?"
        r"(?:ai|llm|model|chatgpt|gpt|claude|gemini|screener|bot)\b",
        re.IGNORECASE),
}


class InjectionFlag(TypedDict):
    kind: str
    line_no: int | None  # 1-based; None for hidden text
    excerpt: str


def scan(lines: list[str], hidden_text: list[str] | None = None) -> list[InjectionFlag]:
    flags: list[InjectionFlag] = []
    for i, line in enumerate(lines, start=1):
        for kind, pattern in PATTERNS.items():
            if pattern.search(line):
                flags.append({"kind": kind, "line_no": i, "excerpt": line[:200]})
    hidden = [t for t in (hidden_text or []) if len(t) >= 3]
    if hidden:
        flags.append({"kind": "hidden_text", "line_no": None, "excerpt": " ".join(hidden)[:200]})
    return flags
