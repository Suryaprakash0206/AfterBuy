// Rasterise the repository's own vector icon. This is not a generated product photo.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const svg = await readFile("frontend/public/icon.svg", "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>body{margin:0;background:#142D4E}svg{width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({ path: `frontend/public/icon-${size}.png` });
  }
} finally {
  await browser.close();
}
