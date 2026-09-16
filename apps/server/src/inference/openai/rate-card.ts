import type { CostReport, ModelTarget, ModelUsage } from "../model-connector.ts";

// Nano-USD per token. Verified against both the pricing and Luna model pages.
export const LUNA_RATE_CARD = {
  id: "openai/gpt-5.6-luna@2026-09-10",
  source: "https://developers.openai.com/api/docs/pricing",
  verifiedAt: "2026-09-10",
  longContextThreshold: 272_000,
  flex: {
    short: { input: 100n, cached: 10n, cacheWrite: 125n, output: 600n },
    long: { input: 200n, cached: 20n, cacheWrite: 250n, output: 900n },
  },
  standard: {
    short: { input: 200n, cached: 20n, cacheWrite: 250n, output: 1200n },
    long: { input: 400n, cached: 40n, cacheWrite: 500n, output: 1800n },
  },
} as const;

export function priceUsage(usage: ModelUsage, target: ModelTarget): CostReport {
  if (target.provider !== "openai" || target.name !== "gpt-5.6-luna")
    throw new Error("Unknown model in rate card");
  const longContext = usage.tokensIn > LUNA_RATE_CARD.longContextThreshold;
  const rates = LUNA_RATE_CARD[usage.servedTier][longContext ? "long" : "short"];
  const nanoUsd =
    BigInt(usage.tokensIn - usage.cachedTokensIn - usage.cacheWriteTokensIn) * rates.input +
    BigInt(usage.cachedTokensIn) * rates.cached +
    BigInt(usage.cacheWriteTokensIn) * rates.cacheWrite +
    BigInt(usage.tokensOut) * rates.output;
  const microUsd = (nanoUsd + 500n) / 1000n;
  return {
    usd: `${microUsd / 1_000_000n}.${(microUsd % 1_000_000n).toString().padStart(6, "0")}`,
    rateCard: {
      id: LUNA_RATE_CARD.id,
      source: LUNA_RATE_CARD.source,
      verifiedAt: LUNA_RATE_CARD.verifiedAt,
      tier: usage.servedTier,
      longContext,
    },
  };
}
