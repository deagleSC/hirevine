import { describe, expect, it } from "vitest";

import { MAX_RESUME_BYTES, checkResumeFile, resumeContentType } from "./upload";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("checkResumeFile", () => {
  it("accepts PDF and DOCX up to 5 MB", () => {
    expect(checkResumeFile({ name: "cv.pdf", type: PDF, size: 1000 })).toBeNull();
    expect(checkResumeFile({ name: "CV.DOCX", type: DOCX, size: MAX_RESUME_BYTES })).toBeNull();
    expect(checkResumeFile({ name: "cv.pdf", type: "", size: 10 })).toBeNull(); // some browsers omit the type
  });

  it("rejects other types, mismatched names, empty and large files", () => {
    expect(checkResumeFile({ name: "cv.doc", type: "application/msword", size: 10 })).toMatch(/PDF or Word/);
    expect(checkResumeFile({ name: "cv.exe", type: PDF, size: 10 })).toMatch(/PDF or Word/);
    expect(checkResumeFile({ name: "cv.pdf", type: PDF, size: 0 })).toMatch(/empty/);
    expect(checkResumeFile({ name: "cv.pdf", type: PDF, size: MAX_RESUME_BYTES + 1 })).toMatch(/5 MB/);
  });

  it("derives the content type from the name when the browser gives none", () => {
    expect(resumeContentType({ name: "a.pdf", type: "" })).toBe(PDF);
    expect(resumeContentType({ name: "a.docx", type: "" })).toBe(DOCX);
  });
});
