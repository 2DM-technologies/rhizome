import { and, count, eq, isNull, sum } from "drizzle-orm";
import type { DashboardStats } from "@rhizome/store-contract";

import type { Database } from "../db/index.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { meterEntries } from "../db/models/meter-entry.ts";
import { operations } from "../db/models/operation.ts";
import { users } from "../db/models/user.ts";

function integer(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Dashboard aggregate is not a non-negative safe integer: ${String(value)}`);
  }
  return parsed;
}

/** Queries owner totals directly so the host never needs access to detached records or meters. */
export class DashboardStatsService {
  constructor(private readonly db: Database) {}

  async get(ownerUuid: string): Promise<DashboardStats> {
    const [accountRows, objectRows, elementRows, usageRows] = await Promise.all([
      this.db
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.uuid, ownerUuid))
        .limit(1),
      this.db
        .select({ value: count() })
        .from(mediaObjects)
        .where(eq(mediaObjects.ownerUuid, ownerUuid)),
      this.db
        .select({ value: count() })
        .from(mediaElements)
        .where(and(eq(mediaElements.ownerUuid, ownerUuid), isNull(mediaElements.tombstonedAt))),
      this.db
        .select({ input: sum(meterEntries.tokensIn), output: sum(meterEntries.tokensOut) })
        .from(meterEntries)
        .innerJoin(operations, eq(operations.uuid, meterEntries.operationUuid))
        .where(eq(operations.ownerUuid, ownerUuid)),
    ]);
    const account = accountRows[0];
    if (!account) throw new Error(`Dashboard owner does not exist: ${ownerUuid}`);
    const input = integer(usageRows[0]?.input);
    const output = integer(usageRows[0]?.output);
    return {
      account_created_at: account.createdAt.toISOString(),
      objects: integer(objectRows[0]?.value),
      elements: integer(elementRows[0]?.value),
      tokens: { input, output, total: input + output },
    };
  }
}
