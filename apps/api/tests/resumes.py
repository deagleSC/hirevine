"""Synthetic resumes built in memory (no binary fixtures in the repo)."""

from __future__ import annotations

import io

RESUME_LINES = [
    "Priya Raman",
    "priya.raman@example.com | +91 98765 43210 | linkedin.com/in/priyaraman",
    "12, 4th Cross Road, Indiranagar, Bengaluru 560038",
    "Date of birth: 04/07/1994",
    "Gender: Female",
    "Senior Backend Engineer",
    "Summary",
    "Backend engineer with 7 years building Python services on PostgreSQL.",
    "Experience",
    "Acme Payments (2019 - 2024): Built a FastAPI payments API handling 2M requests per day.",
    "Designed PostgreSQL schemas and tuned slow queries, cutting p95 latency by 40%.",
    "Ran services on AWS with Docker and Terraform.",
    "Education",
    "B.Tech in Computer Science, National Institute of Technology Trichy, 2016",
]


def pdf_bytes(lines: list[str] = RESUME_LINES, hidden: str | None = None) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    y = 50
    for line in lines:
        page.insert_text((40, y), line, fontsize=10)
        y += 16
    if hidden:
        page.insert_text((40, y + 10), hidden, fontsize=10, color=(1, 1, 1))
    out = doc.tobytes()
    doc.close()
    return out


def docx_bytes(lines: list[str] = RESUME_LINES, hidden: str | None = None) -> bytes:
    import docx
    from docx.shared import RGBColor

    d = docx.Document()
    for line in lines:
        d.add_paragraph(line)
    if hidden:
        run = d.add_paragraph().add_run(hidden)
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()
