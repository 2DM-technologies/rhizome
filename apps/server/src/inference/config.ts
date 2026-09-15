import { loadOpenAIProviderSettings, type OpenAIProviderSettings } from "./openai/config.ts";

export interface InferenceConfig {
  defaultTarget: string;
  openai?: OpenAIProviderSettings;
  useFake: boolean;
}

export function loadInferenceConfig(
  env: Record<string, string | undefined> = process.env,
): InferenceConfig {
  const useFake = env.RHIZOME_USE_FAKE_INFERENCE_PROVIDER === "true";
  if (useFake && env.NODE_ENV === "production") {
    throw new Error("Fake inference is forbidden in production");
  }
  const openai = loadOpenAIProviderSettings(env);
  return {
    defaultTarget: env.RHIZOME_PUSH_DEFAULT_TARGET ?? "model:openai/gpt-5.6-luna",
    ...(openai ? { openai } : {}),
    useFake,
  };
}
