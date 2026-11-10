"""Line-aware chunks for embeddings (backend plan §13 step 4)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

TARGET_CHARS = 400


@dataclass(frozen=True)
class Chunk:
    index: int
    text: str
    start_line: int  # 1-based, inclusive
    end_line: int

    @property
    def text_hash(self) -> str:
        return text_hash(self.text)


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def chunk_lines(lines: list[str], target: int = TARGET_CHARS) -> list[Chunk]:
    """Greedy: whole lines up to ~target chars; a single overlong line is split on spaces."""
    chunks: list[Chunk] = []
    buf: list[str] = []
    start = 1

    def flush(end: int) -> None:
        nonlocal buf
        if buf:
            chunks.append(Chunk(len(chunks), "\n".join(buf), start, end))
            buf = []

    for no, line in enumerate(lines, start=1):
        if len(line) > target:
            flush(no - 1)
            words, piece = line.split(" "), ""
            for w in words:
                if piece and len(piece) + 1 + len(w) > target:
                    chunks.append(Chunk(len(chunks), piece, no, no))
                    piece = w
                else:
                    piece = f"{piece} {w}" if piece else w
            if piece:
                chunks.append(Chunk(len(chunks), piece, no, no))
            start = no + 1
            continue
        if buf and sum(len(b) + 1 for b in buf) + len(line) > target:
            flush(no - 1)
            start = no
        if not buf:
            start = no
        buf.append(line)
    flush(len(lines))
    return chunks
