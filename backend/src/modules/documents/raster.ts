import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";

// Yield one bounded page at a time instead of buffering an entire scanned PDF.
export async function* invoiceImages(bytes: Buffer, mime: string) {
  if (bytes.length > config.MAX_FILE_BYTES)
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      "Invoice exceeds the upload limit.",
    );
  if (mime !== "application/pdf") {
    if (!["image/jpeg", "image/png"].includes(mime))
      throw new AppError(415, "FILE_TYPE", "Upload PDF, JPEG or PNG.");
    const img = await loadImage(bytes);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const canvas = createCanvas(
      Math.max(1, Math.round(img.width * scale)),
      Math.max(1, Math.round(img.height * scale)),
    );
    canvas.getContext("2d").fillStyle = "white";
    canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    yield { page: 1, bytes: canvas.toBuffer("image/jpeg", 85) };
    return;
  }
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > config.MAX_PDF_PAGES)
      throw new AppError(
        422,
        "PAGE_LIMIT",
        "Split this PDF into smaller files.",
      );
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2000 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvas: canvas as any,
        canvasContext: canvas.getContext("2d") as any,
        viewport,
        background: "white",
      }).promise;
      yield { page: number, bytes: canvas.toBuffer("image/jpeg", 85) };
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}
