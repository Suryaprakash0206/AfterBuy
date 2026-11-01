import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { invoiceImages } from "../backend/src/modules/documents/raster.js";
describe("actual local invoice image rendering", () => {
  it("renders every PDF page as a bounded readable JPEG", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 2; n++)
      pdf
        .addPage()
        .drawText(`Invoice page ${n}`, { x: 40, y: 700, font, size: 24 });
    const pages = [];
    for await (const page of invoiceImages(
      Buffer.from(await pdf.save()),
      "application/pdf",
    )) {
      const img = await loadImage(page.bytes);
      expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(2000);
      expect(page.bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
      pages.push(page.page);
    }
    expect(pages).toEqual([1, 2]);
  });
  it("normalizes uploaded PNG photographs", async () => {
    const canvas = createCanvas(2200, 100);
    const images = [];
    for await (const image of invoiceImages(
      canvas.toBuffer("image/png"),
      "image/png",
    ))
      images.push(image);
    expect(images).toHaveLength(1);
    expect((await loadImage(images[0].bytes)).width).toBe(2000);
  });
});
