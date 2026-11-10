"""PDF / DOCX → numbered lines (backend plan §13 step 1).

The file type is sniffed from its bytes, never trusted from the upload's content type.
Hidden text (white or tiny) is returned separately so the injection scan can flag it.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Literal

MAX_BYTES = 5 * 1024 * 1024
MIN_CHARS = 200  # below this the resume is "unreadable" (no OCR in v1)
MAX_LINES = 2000

Kind = Literal["pdf", "docx"]


class UnsupportedFile(ValueError):
    """Not a PDF or DOCX, too large, or could not be opened."""


@dataclass
class ParsedResume:
    lines: list[str]
    parser: str
    hidden_text: list[str] = field(default_factory=list)

    @property
    def char_count(self) -> int:
        return sum(len(line) for line in self.lines)

    @property
    def readable(self) -> bool:
        return self.char_count >= MIN_CHARS


_WS = re.compile(r"\s+")


def clean_lines(raw: str) -> list[str]:
    out = [_WS.sub(" ", line).strip() for line in raw.splitlines()]
    return [line for line in out if line][:MAX_LINES]


def sniff(data: bytes) -> Kind:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "word/document.xml" in z.namelist():
                    return "docx"
        except zipfile.BadZipFile:
            pass
    raise UnsupportedFile("The file is not a PDF or Word (.docx) document.")


def parse(data: bytes) -> ParsedResume:
    if len(data) > MAX_BYTES:
        raise UnsupportedFile("The file is larger than 5 MB.")
    kind = sniff(data)
    try:
        return _parse_pdf(data) if kind == "pdf" else _parse_docx(data)
    except UnsupportedFile:
        raise
    except Exception as exc:  # corrupt files raise library-specific errors
        raise UnsupportedFile(f"The {kind.upper()} could not be read.") from exc


def _is_hidden_colour(rgb: int) -> bool:
    r, g, b = (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF
    return min(r, g, b) >= 0xF0  # white or near-white on a (presumed) white page


def _parse_pdf(data: bytes) -> ParsedResume:
    import pymupdf  # heavy; imported lazily

    lines: list[str] = []
    hidden: list[str] = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass:
            raise UnsupportedFile("The PDF is password-protected.")
        for page in doc:
            lines.extend(clean_lines(page.get_text("text")))
            for block in page.get_text("dict").get("blocks", []):
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if text and (_is_hidden_colour(int(span.get("color", 0))) or span.get("size", 12) < 3):
                            hidden.append(text)
    return ParsedResume(lines[:MAX_LINES], "pymupdf", hidden)


def _parse_docx(data: bytes) -> ParsedResume:
    import docx  # python-docx
    from docx.shared import RGBColor

    document = docx.Document(io.BytesIO(data))
    raw: list[str] = []
    hidden: list[str] = []

    def visit(paragraph: object) -> None:
        raw.append(paragraph.text)  # type: ignore[attr-defined]
        for run in paragraph.runs:  # type: ignore[attr-defined]
            colour = run.font.color.rgb if run.font.color is not None and run.font.color.type else None
            white = isinstance(colour, RGBColor) and min(colour) >= 0xF0
            tiny = run.font.size is not None and run.font.size.pt < 3
            if run.text.strip() and (run.font.hidden or white or tiny):
                hidden.append(run.text.strip())

    for p in document.paragraphs:
        visit(p)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    visit(p)
    return ParsedResume(clean_lines("\n".join(raw)), "python-docx", hidden)
