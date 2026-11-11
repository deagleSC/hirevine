# ADR 0003: Every AI score must quote its evidence, and code checks the quote

Status: accepted (November 2026)

## Decision

Screening scores quote a resume line, interview scores cite candidate answers, and feedback drafts cite stored evidence. Code verifies every citation (normalised substring match against the redacted resume; answer numbers that point at candidate turns; refs that exist) and scores anything unsupported as 0 with a visible flag. A quote from a line the injection scan flagged does not count.

## Why

Scores are auditable by the hiring team and by the candidate after release, hallucinated evidence cannot raise a score, and keyword stuffing aimed at the model (which raised weak resumes by 75 points in the first injection eval) is neutralised: 0% of planted instructions change a score in the current eval.

## Cost

More prompt work (the interview scorer took three versions to cite reliably) and a validation retry when the model skips citations.
