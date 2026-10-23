import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import {
  answerSchema,
  extractionSchema,
  transcriptionSchema,
  type Passage,
  type Extraction,
} from "./schemas.js";
import {
  assistantPrompt,
  extractionPrompt,
  transcriptionPrompt,
} from "./prompts.js";
export interface AIProvider {
  transcribe(
    bytes: Buffer,
    mime: string,
  ): Promise<{ page: number; text: string }[]>;
  extract(text: string): Promise<Extraction>;
  embed(texts: string[]): Promise<number[][]>;
  answer(
    question: string,
    passages: Passage[],
    facts: unknown,
    history: { role: "user" | "assistant"; content: string }[],
  ): Promise<ReturnType<typeof answerSchema.parse>>;
}
export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  constructor() {
    if (!config.OPENAI_API_KEY)
      throw new AppError(
        503,
        "AI_NOT_CONFIGURED",
        "AI is not configured. You can still enter purchase details manually.",
      );
    this.client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      maxRetries: 2,
      timeout: 90000,
    });
  }
  private model(value: string) {
    if (!value)
      throw new AppError(
        503,
        "AI_NOT_CONFIGURED",
        "Configure the required AI model on the backend.",
      );
    return value;
  }
  async transcribe(bytes: Buffer, mime: string) {
    const content: OpenAI.Responses.ResponseInputContent[] =
      mime === "application/pdf"
        ? [
            {
              type: "input_file",
              filename: "document.pdf",
              file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
            },
          ]
        : [
            {
              type: "input_image",
              image_url: `data:${mime};base64,${bytes.toString("base64")}`,
              detail: "high",
            },
          ];
    const response = await this.client.responses.parse({
      model: this.model(config.OPENAI_EXTRACTION_MODEL),
      store: false,
      instructions: transcriptionPrompt,
      input: [{ role: "user", content }],
      text: { format: zodTextFormat(transcriptionSchema, "document_pages") },
      max_output_tokens: config.AI_MAX_OUTPUT_TOKENS,
    });
    if (!response.output_parsed || response.status !== "completed")
      throw new AppError(
        502,
        "AI_INCOMPLETE",
        "The document could not be fully read. Split it into smaller files or enter its details manually.",
      );
    return response.output_parsed.pages;
  }
  async extract(text: string) {
    if (text.length > config.AI_MAX_INPUT_CHARS)
      throw new AppError(
        422,
        "DOCUMENT_TOO_LONG",
        "Split this document into smaller files.",
      );
    const response = await this.client.responses.parse({
      model: this.model(config.OPENAI_EXTRACTION_MODEL),
      store: false,
      instructions: extractionPrompt,
      input: text,
      text: { format: zodTextFormat(extractionSchema, "purchase_extraction") },
      max_output_tokens: config.AI_MAX_OUTPUT_TOKENS,
    });
    if (!response.output_parsed || response.status !== "completed")
      throw new AppError(
        502,
        "AI_INCOMPLETE",
        "Extraction was incomplete. Review the original document and enter details manually.",
      );
    return extractionSchema.parse(response.output_parsed);
  }
  async embed(texts: string[]) {
    const response = await this.client.embeddings.create({
      model: this.model(config.OPENAI_EMBEDDING_MODEL),
      dimensions: config.EMBEDDING_DIMENSIONS,
      input: texts,
      encoding_format: "float",
    });
    const vectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((x) => x.embedding);
    if (
      vectors.length !== texts.length ||
      vectors.some((v) => v.length !== 1536)
    )
      throw new Error("EMBEDDING_CONTRACT");
    return vectors;
  }
  async answer(
    question: string,
    passages: Passage[],
    facts: unknown,
    history: { role: "user" | "assistant"; content: string }[],
  ) {
    const response = await this.client.responses.parse({
      model: this.model(config.OPENAI_CHAT_MODEL),
      store: false,
      instructions: assistantPrompt,
      input: [
        {
          role: "user",
          content: JSON.stringify({ exact_facts: facts, passages }),
        },
        ...history.slice(-8),
        { role: "user", content: question },
      ],
      text: { format: zodTextFormat(answerSchema, "grounded_answer") },
      max_output_tokens: config.AI_MAX_OUTPUT_TOKENS,
    });
    if (!response.output_parsed || response.status !== "completed")
      throw new AppError(
        502,
        "AI_UNAVAILABLE",
        "The assistant could not finish. Your documents are unchanged.",
      );
    return answerSchema.parse(response.output_parsed);
  }
}
