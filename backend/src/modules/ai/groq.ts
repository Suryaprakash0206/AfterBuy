import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { extractionSchema, transcriptionSchema } from "./schemas.js";
import { extractionPrompt, transcriptionPrompt } from "./prompts.js";
import { invoiceImages } from "../documents/raster.js";
import type { z } from "zod";

export class GroqExtractionProvider {
  private client: OpenAI;
  private deadline = Date.now() + 10 * 60000;
  constructor() {
    if (!config.GROQ_API_KEY)
      throw new AppError(
        503,
        "AI_NOT_CONFIGURED",
        "Configure the backend Groq API key.",
      );
    this.client = new OpenAI({
      apiKey: config.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      maxRetries: 2,
      timeout: 90000,
    });
  }
  private async structured<T>(
    model: string,
    schema: z.ZodType<T>,
    name: string,
    instructions: string,
    content: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"],
  ): Promise<T> {
    if (!model)
      throw new AppError(
        503,
        "AI_NOT_CONFIGURED",
        "Select a Groq extraction and vision model.",
      );
    try {
      const remaining = this.deadline - Date.now();
      if (remaining <= 0)
        throw new AppError(
          422,
          "SCAN_TIME_LIMIT",
          "Split this invoice into smaller files and retry.",
        );
      const response = await this.client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content },
          ],
          response_format: zodResponseFormat(schema, name),
          max_completion_tokens: config.AI_MAX_OUTPUT_TOKENS,
          stream: false,
        },
        { signal: AbortSignal.timeout(remaining) },
      );
      const choice = response.choices[0];
      if (
        !choice ||
        choice.finish_reason !== "stop" ||
        !choice.message.content ||
        choice.message.refusal
      )
        throw new AppError(
          502,
          "AI_INCOMPLETE",
          "Groq could not finish reading the invoice. Try fewer pages or review manually.",
        );
      const parsed = schema.safeParse(JSON.parse(choice.message.content));
      if (!parsed.success)
        throw new AppError(
          502,
          "AI_INVALID_OUTPUT",
          "Groq returned incomplete invoice fields. Retry or review manually.",
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = (error as { status?: number }).status;
      if (status === 429)
        throw new AppError(
          429,
          "AI_RATE_LIMIT",
          "Groq usage limit reached. Wait before retrying the scan.",
        );
      if (status === 401 || status === 403)
        throw new AppError(
          503,
          "AI_CREDENTIALS",
          "Check the backend Groq key and model access.",
        );
      if (status === 400 || status === 404)
        throw new AppError(
          502,
          "AI_MODEL_UNAVAILABLE",
          "Check that the configured Groq model supports this request.",
        );
      throw new AppError(
        502,
        "AI_UNAVAILABLE",
        "The invoice scanner could not reach Groq or read its response. Retry shortly.",
      );
    }
  }
  async extract(text: string) {
    if (text.length > config.AI_MAX_INPUT_CHARS)
      throw new AppError(
        422,
        "DOCUMENT_TOO_LONG",
        "Split this invoice into smaller files.",
      );
    return this.structured(
      config.GROQ_EXTRACTION_MODEL,
      extractionSchema,
      "purchase_extraction",
      extractionPrompt,
      text,
    );
  }
  async transcribe(bytes: Buffer, mime: string) {
    const pages: { page: number; text: string }[] = [];
    let length = 0;
    for await (const image of invoiceImages(bytes, mime)) {
      const result = await this.structured(
        config.GROQ_VISION_MODEL,
        transcriptionSchema,
        "invoice_page",
        transcriptionPrompt +
          " This request contains one page. Return exactly one pages entry numbered 1.",
        [
          { type: "text", text: "Transcribe this invoice page as JSON." },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${image.bytes.toString("base64")}`,
            },
          },
        ],
      );
      if (result.pages.length !== 1 || result.pages[0].page !== 1)
        throw new AppError(
          502,
          "INCOMPLETE_PAGES",
          "The scanner did not return the expected page.",
        );
      length += result.pages[0].text.length;
      if (length > config.AI_MAX_INPUT_CHARS)
        throw new AppError(
          422,
          "DOCUMENT_TOO_LONG",
          "Split this invoice into smaller files.",
        );
      pages.push({ page: image.page, text: result.pages[0].text });
    }
    return pages;
  }
}
