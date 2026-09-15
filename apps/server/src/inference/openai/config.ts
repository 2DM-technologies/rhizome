export interface OpenAIProviderSettings {
  apiKey: string;
  baseUrl: string;
}

export function loadOpenAIProviderSettings(
  env: Record<string, string | undefined> = process.env,
): OpenAIProviderSettings | undefined {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;
  const baseUrl = new URL(env.OPENAI_BASE_URL ?? "https://api.openai.com");
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw new Error(
      "OPENAI_BASE_URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  return { apiKey, baseUrl: baseUrl.href.replace(/\/+$/, "") };
}
