import { describe, it, expect, vi, beforeEach } from "vitest";
// Explicit external SDK mocks. These tests do not contact OpenAI or validate model availability.
const sdk = vi.hoisted(() => ({ parse: vi.fn(), embed: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { parse: sdk.parse };
    embeddings = { create: sdk.embed };
  },
}));
vi.mock("../backend/src/config.js", () => ({
  config: {
    OPENAI_API_KEY: "mock-test-key",
    OPENAI_EXTRACTION_MODEL: "mock-extraction",
    OPENAI_CHAT_MODEL: "mock-chat",
    OPENAI_EMBEDDING_MODEL: "mock-embedding",
    EMBEDDING_DIMENSIONS: 1536,
    AI_MAX_INPUT_CHARS: 80000,
    AI_MAX_OUTPUT_TOKENS: 6000,
  },
}));
import { OpenAIProvider } from "../backend/src/modules/ai/provider.js";
import { resolveAnswer } from "../backend/src/modules/ai/schemas.js";
describe("OpenAI adapter — mocked external SDK", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["image/jpeg", "image/png", "application/pdf"])("reads %s through the vision-capable extraction model (mock response)", async (mime) => {
    sdk.parse.mockResolvedValue({status:"completed",output_parsed:{pages:[{page:1,text:"Test invoice: Kettle 81.00 USD"}]}});
    expect(await new OpenAIProvider().transcribe(Buffer.from('mock-file-bytes'),mime)).toEqual([{page:1,text:"Test invoice: Kettle 81.00 USD"}]);
    const request=sdk.parse.mock.calls[0][0];
    expect(request.model).toBe('mock-extraction');
    expect(request.store).toBe(false);
    expect(request.input[0].content[0].type).toBe(mime==='application/pdf'?'input_file':'input_image');
    expect(request.text.format.type).toBe('json_schema');
    expect(request.tools).toBeUndefined();
  });
  it("rejects truncated extraction rather than accepting partial records", async () => {
    sdk.parse.mockResolvedValue({ status: "incomplete", output_parsed: {} });
    await expect(
      new OpenAIProvider().extract("Invoice text"),
    ).rejects.toMatchObject({ code: "AI_INCOMPLETE" });
    expect(sdk.parse.mock.calls[0][0]).toMatchObject({
      store: false,
      model: "mock-extraction",
    });
    expect(sdk.parse.mock.calls[0][0].tools).toBeUndefined();
  });
  it("does not invent an answer on provider failure", async () => {
    sdk.parse.mockRejectedValue(new Error("Mock upstream unavailable"));
    await expect(
      new OpenAIProvider().answer("Repair?", [], {}, []),
    ).rejects.toThrow("Mock upstream unavailable");
  });
  it("enforces the embedding dimension contract", async () => {
    sdk.embed.mockResolvedValue({ data: [{ index: 0, embedding: [0, 1] }] });
    await expect(new OpenAIProvider().embed(["manual"])).rejects.toThrow(
      "EMBEDDING_CONTRACT",
    );
  });
  it("resolves citations only against the supplied authorised passages", () => {
    const passage = {
      id: "allowed",
      document_id: "document",
      page: 2,
      content: "Hold reset for five seconds.",
      name: "Manual.pdf",
    };
    expect(() =>
      resolveAnswer(
        {
          answer: "Hold reset for five seconds.",
          evidence_found: true,
          source_ids: ["allowed", "unrelated-product"],
        },
        [passage],
      ),
    ).toThrow("INVALID_CITATION");
    expect(
      resolveAnswer(
        {
          answer: "Hold reset for five seconds.",
          evidence_found: true,
          source_ids: ["allowed"],
        },
        [passage],
      ).sources,
    ).toEqual([passage]);
  });
});
