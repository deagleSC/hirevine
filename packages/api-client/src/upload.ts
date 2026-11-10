/** Resume upload rules shared by the apply wizard and its tests (frontend plan §8.1). */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_TYPES: Record<string, "pdf" | "docx"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** A plain-language problem with the file, or null if it can be uploaded. */
export function checkResumeFile(file: { name: string; type: string; size: number }): string | null {
  const ext = file.name.toLowerCase().split(".").pop();
  const kind = RESUME_TYPES[file.type] ?? (ext === "pdf" || ext === "docx" ? ext : undefined);
  if (!kind || ext !== kind) return "Choose a PDF or Word (.docx) file.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "The file must be 5 MB or smaller.";
  return null;
}

export function resumeContentType(file: { name: string; type: string }): string {
  if (RESUME_TYPES[file.type]) return file.type;
  return file.name.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/**
 * PUT the file straight to the signed Storage URL (it never passes through the API), reporting
 * progress. XHR, because fetch cannot report upload progress.
 */
export function uploadToSignedUrl(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
