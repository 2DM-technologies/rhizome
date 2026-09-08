import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.ts";

export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10 });
  return { db: drizzle(client, { schema }), client };
}

/**
 * Provider requests hold PostgreSQL session advisory locks while network I/O is in flight.
 * Keep those deliberately long-lived sessions out of the ordinary API pool so a slow provider
 * cannot consume every connection needed by health, status, and recovery routes.
 */
export function createProviderLeasePool(url: string, options: { max?: number } = {}) {
  return postgres(url, { max: options.max ?? 4 });
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type ProviderLeasePool = Pick<ReturnType<typeof createProviderLeasePool>, "reserve">;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
