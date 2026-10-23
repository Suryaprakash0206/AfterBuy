import { test, expect } from "@playwright/test";
test("LIVE configured integration: sign in, manual purchase, coverage, case, export", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_LIVE_URL ||
      !process.env.E2E_EMAIL ||
      !process.env.E2E_PASSWORD,
    "Requires an explicitly configured isolated test workspace and verified account; no production writes by default.",
  );
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(process.env.E2E_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill(`Integration test ${Date.now()}`);
  await page.getByLabel("Purchase date", { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await page.getByRole("button", { name: "Add coverage", exact: true }).click();
  await page
    .getByLabel("Provider", { exact: true })
    .fill("Integration test provider");
  await page
    .getByLabel("Explicit start date", { exact: true })
    .fill("2026-10-01");
  await page
    .getByLabel("Duration in calendar months", { exact: true })
    .fill("12");
  await page.getByLabel("I checked these terms and confirm the dates.").check();
  await page.getByRole("button", { name: "Save coverage" }).click();
  await expect(
    page.getByRole("heading", { name: "Integration test provider" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Report an issue", exact: true })
    .click();
  await page.getByLabel("Issue summary").fill("Integration test case");
  await page
    .getByLabel("What happened?")
    .fill("Explicit integration test; no external messages.");
  await page.getByRole("button", { name: "Create service case" }).click();
  await page.getByRole("link", { name: "Prepare support package" }).click();
  await page.getByRole("button", { name: "Preview package" }).click();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await promise).suggestedFilename()).toMatch(/\.pdf$/);
});
