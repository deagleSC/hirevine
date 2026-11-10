"""Quote verification (backend plan §13 step 7): a quote counts only if it appears in the redacted
resume text after normalising case, whitespace and punctuation (so a quote may run across lines)."""

from __future__ import annotations

import re

MIN_QUOTE_CHARS = 8
_TRANSLATE = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "•": " ", " ": " "})
_SEP = re.compile(r"[^\w%+#@/$]+")  # punctuation and whitespace both become one space
_PLACEHOLDER = re.compile(r"\[[A-Z ]+\]")


def normalize(text: str) -> str:
    return _SEP.sub(" ", text.translate(_TRANSLATE).lower()).strip()


def locate(quote: str, lines: list[str]) -> int | None:
    """The 1-based line where the quote starts, or None if it is not in the text.
    Quotes may span line breaks. Placeholder-only quotes (e.g. "[EMAIL]") never verify."""
    if len(normalize(_PLACEHOLDER.sub(" ", quote))) < MIN_QUOTE_CHARS:
        return None
    q = normalize(quote)
    starts: list[int] = []
    parts: list[str] = []
    pos = 0
    for line in lines:
        n = normalize(line)
        starts.append(pos)
        parts.append(n)
        pos += len(n) + 1
    hay = " ".join(parts)
    at = hay.find(q)
    if at < 0:
        return None
    line_no = 1
    for i, s in enumerate(starts):
        if s <= at:
            line_no = i + 1
        else:
            break
    return line_no
