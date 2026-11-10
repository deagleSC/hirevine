"""PII removal before any model or trace sees resume text (backend plan §13 step 2).

Line count and order are preserved so citations can point at a line number. Each line is
redacted independently. spaCy NER (PERSON / GPE) runs only if spaCy and `en_core_web_sm`
are installed; the regex and keyword rules always run.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

log = logging.getLogger("hirevine.pipeline")

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(
    r"(?:https?://|www\.)\S+|\b(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|behance\.net)/\S*",
    re.IGNORECASE,
)
# 10+ digits, optionally with +country code and separators. Year ranges ("2019 - 2023") have 8.
PHONE = re.compile(r"(?<![\w/])\+?\(?\d[\d\s().-]{8,}\d(?![\w/])")
DOB_LINE = re.compile(r"\b(?:d\.?o\.?b\.?|date of birth|born on|birth ?date)\b", re.IGNORECASE)
SENSITIVE_LINE = re.compile(
    r"^\s*(?:gender|sex|marital status|married|unmarried|religion|caste|nationality|age|father'?s name|"
    r"mother'?s name|spouse|photo(?:graph)?|blood group|height|weight)\s*[:\-–]",
    re.IGNORECASE,
)
SENSITIVE_WORDS = re.compile(
    r"\b(?:male|female|married|unmarried|divorced|widowed|photo attached|photograph attached)\b",
    re.IGNORECASE,
)
PIN = re.compile(r"\b\d{3}\s?\d{3}\b")
STREET = re.compile(
    r"\b\d+[\w/-]*,?\s+(?:[\w.'-]+\s+){0,4}(?:road|rd\.?|street|st\.?|lane|ln\.?|avenue|ave\.?|nagar|marg|"
    r"sector|block|layout|colony|apartments?|apt\.?|flat|floor|cross|main)\b",
    re.IGNORECASE,
)
ADDRESS_HINT = re.compile(r"\b(?:address|road|street|nagar|marg|sector|colony|layout|pin(?:code)?|district)\b",
                          re.IGNORECASE)
INSTITUTION = re.compile(r"\b(?:university|college|institute|school|academy|iit|iim|nit|bits)\b", re.IGNORECASE)
HEADER_WORDS = re.compile(
    r"\b(?:resume|curriculum|vitae|cv|profile|summary|experience|education|skills|objective|contact|"
    r"engineer|developer|manager|designer|analyst|scientist|consultant|lead|architect|intern|specialist|"
    r"administrator|officer|executive|director|associate|technician)\b",
    re.IGNORECASE,
)
NAME_LIKE = re.compile(r"^(?:[A-Z][a-zA-Z'.-]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-zA-Z'.-]+|[A-Z]{2,}|[A-Z]\.)){1,3}$")


@dataclass
class Redacted:
    lines: list[str]
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def _sub(pattern: re.Pattern[str], repl: str, line: str, counts: dict[str, int], key: str) -> str:
    new, n = pattern.subn(repl, line)
    if n:
        counts[key] = counts.get(key, 0) + n
    return new


def _phones(line: str, counts: dict[str, int]) -> str:
    """A phone needs 10-15 digits; year ranges and figures with separators have fewer."""
    def repl(m: re.Match[str]) -> str:
        digits = sum(ch.isdigit() for ch in m.group())
        if 10 <= digits <= 15:
            counts["phone"] = counts.get("phone", 0) + 1
            return "[PHONE]"
        return m.group()

    return PHONE.sub(repl, line)


@lru_cache(maxsize=1)
def _nlp() -> Any | None:
    try:
        import spacy  # type: ignore[import-not-found]

        return spacy.load("en_core_web_sm", disable=["parser", "lemmatizer", "textcat"])
    except Exception:  # not installed in this environment: regex rules only
        log.info("spaCy en_core_web_sm not available; redaction uses regex rules only")
        return None


def _ner(lines: list[str], counts: dict[str, int]) -> list[str]:
    nlp = _nlp()
    if nlp is None:
        return lines
    out = []
    for doc in nlp.pipe(lines, batch_size=64):
        line = doc.text
        for ent in reversed(doc.ents):
            if ent.label_ in ("PERSON", "GPE"):
                tag = "[NAME]" if ent.label_ == "PERSON" else "[LOCATION]"
                line = line[: ent.start_char] + tag + line[ent.end_char :]
                counts[ent.label_.lower()] = counts.get(ent.label_.lower(), 0) + 1
        out.append(line)
    return out


def redact(lines: list[str], *, keep_education: bool = True, use_ner: bool = True) -> Redacted:
    counts: dict[str, int] = {}
    out: list[str] = []
    for i, line in enumerate(lines):
        if DOB_LINE.search(line):
            out.append("[DOB REMOVED]")
            counts["dob"] = counts.get("dob", 0) + 1
            continue
        if SENSITIVE_LINE.search(line):
            out.append("[PERSONAL DETAIL REMOVED]")
            counts["personal"] = counts.get("personal", 0) + 1
            continue
        if STREET.search(line) or (PIN.search(line) and ADDRESS_HINT.search(line)):
            out.append("[ADDRESS REMOVED]")
            counts["address"] = counts.get("address", 0) + 1
            continue
        if not keep_education and INSTITUTION.search(line):
            out.append("[EDUCATION REMOVED]")
            counts["education"] = counts.get("education", 0) + 1
            continue
        line = _sub(EMAIL, "[EMAIL]", line, counts, "email")
        line = _sub(URL, "[URL]", line, counts, "url")
        line = _phones(line, counts)
        line = _sub(SENSITIVE_WORDS, "[REMOVED]", line, counts, "personal")
        # The first lines of a resume usually carry the candidate's name on its own.
        if i < 3 and NAME_LIKE.match(line) and not HEADER_WORDS.search(line):
            line = "[NAME]"
            counts["name"] = counts.get("name", 0) + 1
        out.append(line)
    if use_ner:
        out = _ner(out, counts)
    return Redacted(out, counts)
