import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  options: vi.fn(),
  key: "test-key",
}));
vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      mocked.options(options);
    }
    chat = { completions: { create: mocked.create } };
  },
}));
vi.mock("../backend/src/config.js", () => ({
  config: {
    get GROQ_API_KEY() {
      return mocked.key;
    },
    GROQ_EXTRACTION_MODEL: "test-text",
    GROQ_VISION_MODEL: "test-vision",
    AI_MAX_OUTPUT_TOKENS: 6000,
    AI_MAX_INPUT_CHARS: 1000,
  },
}));
vi.mock("../backend/src/modules/documents/raster.js", () => ({
  async *invoiceImages() {
    yield { page: 1, bytes: Buffer.from("page-one") };
    yield { page: 2, bytes: Buffer.from("page-two") };
  },
}));
import { GroqExtractionProvider } from "../backend/src/modules/ai/groq.js";
const extraction = {
  seller: null,
  invoice_number: null,
  purchase_date: null,
  currency: null,
  subtotal: null,
  tax: null,
  total: null,
  items: [],
  warranties: [],
  evidence: [],
  warnings: [],
};
const response = (value: unknown, finish_reason = "stop") => ({
  choices: [{ finish_reason, message: { content: JSON.stringify(value) } }],
});
describe("Groq invoice adapter with mocked external API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.key = "test-key";
  });
  it("uses only Groq credentials and strict schema output", async () => {
    mocked.create.mockResolvedValue(response(extraction));
    expect(await new GroqExtractionProvider().extract("Invoice")).toEqual(
      extraction,
    );
    expect(mocked.options).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        baseURL: "https://api.groq.com/openai/v1",
      }),
    );
    expect(mocked.create.mock.calls[0][0]).toMatchObject({
      model: "test-text",
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
  });
  it("transcribes pages separately and preserves original page numbers", async () => {
    mocked.create.mockResolvedValue(
      response({ pages: [{ page: 1, text: "Invoice text" }] }),
    );
    const pages = await new GroqExtractionProvider().transcribe(
      Buffer.from("pdf"),
      "application/pdf",
    );
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(mocked.create).toHaveBeenCalledTimes(2);
    expect(
      mocked.create.mock.calls[0][0].messages[1].content[1].image_url.url,
    ).toMatch(/^data:image\/jpeg;base64,/);
  });
  it("rejects truncated or invalid structured output", async () => {
    mocked.create.mockResolvedValue(response(extraction, "length"));
    await expect(
      new GroqExtractionProvider().extract("Invoice"),
    ).rejects.toMatchObject({ code: "AI_INCOMPLETE" });
    mocked.create.mockResolvedValue(response({ items: [] }));
    await expect(
      new GroqExtractionProvider().extract("Invoice"),
    ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
  });
  it.each([
    [429, "AI_RATE_LIMIT"],
    [401, "AI_CREDENTIALS"],
    [400, "AI_MODEL_UNAVAILABLE"],
    [500, "AI_UNAVAILABLE"],
  ])(
    "maps upstream status %s without exposing response content",
    async (status, code) => {
      mocked.create.mockRejectedValue({ status, message: "secret response" });
      await expect(
        new GroqExtractionProvider().extract("Invoice"),
      ).rejects.toMatchObject({ code });
    },
  );
  it("requires a Groq key", () => {
    mocked.key = "";
    expect(() => new GroqExtractionProvider()).toThrow("Groq API key");
  });
  it("rejects oversized input before sending it", async () => {
    await expect(
      new GroqExtractionProvider().extract("x".repeat(1001)),
    ).rejects.toMatchObject({ code: "DOCUMENT_TOO_LONG" });
    expect(mocked.create).not.toHaveBeenCalled();
  });
});
