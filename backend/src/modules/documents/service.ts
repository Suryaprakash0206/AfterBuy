import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
export async function inspectFile(bytes: Buffer, declaredMime: string) {
  if (bytes.length > config.MAX_FILE_BYTES)
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      "This file exceeds the configured upload limit.",
    );
  const detected = await fileTypeFromBuffer(bytes);
  if (
    !detected ||
    !["application/pdf", "image/jpeg", "image/png"].includes(detected.mime) ||
    detected.mime !== declaredMime
  )
    throw new AppError(
      415,
      "FILE_TYPE",
      "Upload a valid PDF, JPEG, or PNG file.",
    );
  let pages = 1;
  if (detected.mime === "application/pdf") {
    try {
      const task = getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      try {
        const pdf = await task.promise;
        pages = pdf.numPages;
      } finally {
        await task.destroy();
      }
    } catch {
      throw new AppError(
        422,
        "INVALID_PDF",
        "This PDF is damaged or password protected. Upload an unlocked copy.",
      );
    }
  }
  if (pages > config.MAX_PDF_PAGES)
    throw new AppError(
      422,
      "PAGE_LIMIT",
      `Use a document with at most ${config.MAX_PDF_PAGES} pages.`,
    );
  return {
    mime: detected.mime,
    pages,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function pdfPages(bytes: Buffer) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    const pages: { page: number; text: string }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      pages.push({
        page: i,
        text: text.items
          .map((x) =>
            "str" in x ? x.str + ("hasEOL" in x && x.hasEOL ? "\n" : " ") : "",
          )
          .join(""),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
export function chunkPages(
  pages: { page: number; text: string }[],
  size = 1600,
  overlap = 200,
) {
  const chunks: { page: number; ordinal: number; content: string }[] = [];
  for (const page of pages) {
    for (let start = 0; start < page.text.length; start += size - overlap) {
      const content = page.text.slice(start, start + size).trim();
      if (content)
        chunks.push({ page: page.page, ordinal: chunks.length, content });
    }
  }
  return chunks;
}
export function safeFilename(name: string) {
  return (
    name
      .replace(/[^\p{L}\p{N}._ -]/gu, "_")
      .replace(/^\.+/, "")
      .slice(0, 160) || "document"
  );
}
