"""Protected-characteristic check for criteria names (backend plan §12). A warning, never a block.

The keyword list covers the characteristics the interview wrapper refuses to ask about:
age, gender, marital and family status, religion, caste, disability, nationality, plus
close proxies. The JD agent (Phase 4) adds an LLM judgment on top of this list.
"""

from __future__ import annotations

import re

_PATTERNS: dict[str, list[str]] = {
    "age": [r"\bage[ds]?\b", r"\byoung\b", r"\byouthful\b", r"\bunder \d{2}\b", r"\bover \d{2}\b",
            r"\bdigital native\b", r"\brecent graduate only\b", r"\bborn (?:in|after|before)\b"],
    "gender": [r"\bgender\b", r"\bmale\b", r"\bfemale\b", r"\bman\b", r"\bwoman\b", r"\bmen\b", r"\bwomen\b",
               r"\bgirls?\b", r"\bboys?\b", r"\bsex\b"],
    "marital or family status": [r"\bmarried\b", r"\bunmarried\b", r"\bmarital\b",
                                 r"\bchildren\b", r"\bkids\b", r"\bpregnan\w*\b", r"\bfamily planning\b"],
    "religion": [r"\breligio\w*\b", r"\bhindu\b", r"\bmuslim\b", r"\bchristian\b", r"\bsikh\b", r"\bjain\b",
                 r"\bbuddhist\b", r"\bjewish\b", r"\bfaith\b"],
    "caste": [r"\bcaste\b", r"\bbrahmin\b", r"\bdalit\b", r"\bupper[- ]class\b", r"\bcommunity of\b"],
    "disability": [r"\bdisab\w*\b", r"\bable[- ]bodied\b", r"\bhandicap\w*\b",
                   r"\bno medical\b"],
    "nationality or origin": [r"\bnationality\b", r"\bnative speaker\b", r"\bcitizen(?:ship)? only\b",
                              r"\bethnic\w*\b", r"\brace\b", r"\bnational origin\b", r"\blocal(?:s)? only\b"],
}
_COMPILED = {k: [re.compile(p, re.IGNORECASE) for p in v] for k, v in _PATTERNS.items()}


def protected_warnings(text: str) -> list[str]:
    """Characteristics `text` appears to screen on. Empty when nothing matches."""
    return [k for k, pats in _COMPILED.items() if any(p.search(text) for p in pats)]
