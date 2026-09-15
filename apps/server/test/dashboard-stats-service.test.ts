import { expect, test } from "bun:test";

import type { Database } from "../src/db/index.ts";
import { DashboardStatsService } from "../src/services/dashboard-stats-service.ts";

function databaseReturning(...results: unknown[][]): Database {
  let index = 0;
  return {
    select() {
      const rows = results[index++] ?? [];
      const query = {
        from() {
          return query;
        },
        innerJoin() {
          return query;
        },
        where() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as Database;
}

test("dashboard stats combine lifetime owner totals and account creation time", async () => {
  const service = new DashboardStatsService(
    databaseReturning(
      [{ createdAt: new Date("2024-03-14T12:00:00.000Z") }],
      [{ value: 12 }],
      [{ value: 34 }],
      [{ input: "5000", output: "1700" }],
    ),
  );

  await expect(service.get("0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47")).resolves.toEqual({
    account_created_at: "2024-03-14T12:00:00.000Z",
    objects: 12,
    elements: 34,
    tokens: { input: 5_000, output: 1_700, total: 6_700 },
  });
});

test("dashboard stats reject unsafe database aggregates", async () => {
  const service = new DashboardStatsService(
    databaseReturning(
      [{ createdAt: new Date("2024-03-14T12:00:00.000Z") }],
      [{ value: 0 }],
      [{ value: 0 }],
      [{ input: "9007199254740992", output: "0" }],
    ),
  );

  await expect(service.get("0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47")).rejects.toThrow(
    "not a non-negative safe integer",
  );
});
