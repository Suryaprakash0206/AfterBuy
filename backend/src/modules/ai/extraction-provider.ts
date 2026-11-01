import { extractionProviderName } from "../../config.js";
import { OpenAIProvider, type AIProvider } from "./provider.js";
import { GroqExtractionProvider } from "./groq.js";
export type ExtractionProvider = Pick<AIProvider, "extract" | "transcribe">;
export function createExtractionProvider(): ExtractionProvider {
  return extractionProviderName() === "groq"
    ? new GroqExtractionProvider()
    : new OpenAIProvider();
}
