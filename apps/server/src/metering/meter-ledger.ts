import type { PushOperationResult } from "@rhizome/store-contract";
import { eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { meterEntries } from "../db/models/meter-entry.ts";
import type { OperationStatus } from "../db/models/operation.ts";
import type { ModelConnectorRegistry } from "../inference/connector-registry.ts";
import type { ModelUsage, ModelConnectorErrorKind } from "../inference/model-connector.ts";
import { STORE_ACTOR } from "../rnet.ts";

type Usage = NonNullable<PushOperationResult["usage"]>;
interface LedgerCall {
  index: number;
  objects: number;
  outcome: "completed" | ModelConnectorErrorKind;
  attempts: number;
  provider_request_id: string | null;
  served_tier: ModelUsage["servedTier"];
  served_tier_raw: string | null;
  tier_assumed: boolean;
  tokens_in: number;
  cached_tokens_in: number;
  cache_write_tokens_in: number;
  tokens_out: number;
  reasoning_tokens_out: number;
  duration_ms: number;
  long_context?: boolean;
  usd?: string;
}
interface Breakdown extends Record<string, unknown> {
  status: OperationStatus;
  task: string;
  requested_tier: "flex";
  rate_card: { id: string; source: string; verified_at: string };
  invoked_by: string;
  calls: LedgerCall[];
  totals: Usage & { cache_write_tokens_in: number; reasoning_tokens_out: number };
}

const zeroUsage = (): ModelUsage => ({
  tokensIn: 0,
  cachedTokensIn: 0,
  cacheWriteTokensIn: 0,
  tokensOut: 0,
  reasoningTokensOut: 0,
  servedTier: "flex",
  servedTierRaw: null,
  tierAssumed: false,
  providerModel: null,
  providerRequestId: null,
  durationMs: 0,
  attempts: 0,
});

export class MeterLedger {
  private constructor(
    private readonly db: Database,
    readonly operationUuid: string,
    private readonly registry: ModelConnectorRegistry,
    private readonly breakdown: Breakdown,
  ) {}

  static async open(
    transaction: DatabaseTransaction,
    registry: ModelConnectorRegistry,
    operationUuid: string,
    task: string,
    invokedBy: string,
  ): Promise<void> {
    const { rateCard } = registry.connector.reportCost(zeroUsage(), registry.target);
    const breakdown: Breakdown = {
      status: "queued",
      task,
      requested_tier: "flex",
      rate_card: { id: rateCard.id, source: rateCard.source, verified_at: rateCard.verifiedAt },
      invoked_by: invokedBy,
      calls: [],
      totals: {
        tokens_in: 0,
        cached_tokens_in: 0,
        cache_write_tokens_in: 0,
        tokens_out: 0,
        reasoning_tokens_out: 0,
        usd: "0.000000",
        served_tiers: [],
        tier_assumed: false,
      },
    };
    await transaction.insert(meterEntries).values({
      operationUuid,
      payer: STORE_ACTOR,
      model: registry.identity,
      tokensIn: 0,
      tokensOut: 0,
      turns: 0,
      usd: "0.000000",
      breakdown,
    });
  }

  static async load(
    db: Database,
    operationUuid: string,
    registry: ModelConnectorRegistry,
  ): Promise<MeterLedger> {
    const row = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operationUuid),
    });
    if (!row?.breakdown) throw new Error("Push ledger missing");
    return new MeterLedger(db, operationUuid, registry, row.breakdown as Breakdown);
  }

  get usage(): Usage {
    const {
      cache_write_tokens_in: _cacheWrite,
      reasoning_tokens_out: _reasoning,
      ...usage
    } = this.breakdown.totals;
    return { ...usage, served_tiers: [...usage.served_tiers] };
  }

  async record(
    usage: ModelUsage,
    call: Pick<LedgerCall, "index" | "objects" | "outcome">,
  ): Promise<void> {
    const row: LedgerCall = {
      ...call,
      attempts: usage.attempts,
      provider_request_id: usage.providerRequestId,
      served_tier: usage.servedTier,
      served_tier_raw: usage.servedTierRaw,
      tier_assumed: usage.tierAssumed,
      tokens_in: usage.tokensIn,
      cached_tokens_in: usage.cachedTokensIn,
      cache_write_tokens_in: usage.cacheWriteTokensIn,
      tokens_out: usage.tokensOut,
      reasoning_tokens_out: usage.reasoningTokensOut,
      duration_ms: usage.durationMs,
    };
    this.breakdown.calls.push(row);
    this.breakdown.status = "running";
    const totals = this.breakdown.totals;
    totals.tokens_in += usage.tokensIn;
    totals.cached_tokens_in += usage.cachedTokensIn;
    totals.cache_write_tokens_in += usage.cacheWriteTokensIn;
    totals.tokens_out += usage.tokensOut;
    totals.reasoning_tokens_out += usage.reasoningTokensOut;
    totals.served_tiers = [...new Set([...totals.served_tiers, usage.servedTier])].sort();
    totals.tier_assumed ||= usage.tierAssumed;
    // Persist every reported token before pricing can throw, and before any inferred write.
    await this.persist();
    const cost = this.registry.connector.reportCost(usage, this.registry.target);
    row.usd = cost.usd;
    row.long_context = cost.rateCard.longContext;
    totals.usd = usdFromNanos(nanosFromUsd(totals.usd) + nanosFromUsd(cost.usd));
    await this.persist();
  }

  async close(
    transaction: DatabaseTransaction,
    status: OperationStatus,
    durationMs: number,
    abortReason: PushOperationResult["abort_reason"],
  ): Promise<void> {
    this.breakdown.status = status;
    await transaction
      .update(meterEntries)
      .set({ durationMs, abortReason, breakdown: this.breakdown })
      .where(eq(meterEntries.operationUuid, this.operationUuid));
  }

  private async persist(): Promise<void> {
    await this.db
      .update(meterEntries)
      .set({
        tokensIn: this.breakdown.totals.tokens_in,
        tokensOut: this.breakdown.totals.tokens_out,
        turns: this.breakdown.calls.length,
        usd: this.breakdown.totals.usd,
        breakdown: this.breakdown,
      })
      .where(eq(meterEntries.operationUuid, this.operationUuid));
  }
}

function nanosFromUsd(usd: string): bigint {
  const [whole, fraction = ""] = usd.split(".");
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}
function usdFromNanos(nanos: bigint): string {
  const micros = (nanos + 500n) / 1000n;
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
}
