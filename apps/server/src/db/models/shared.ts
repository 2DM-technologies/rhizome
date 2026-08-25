import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type JsonObject = Record<string, unknown>;

export type TextEnum = readonly [string, ...string[]];

export function textEnumCheck(column: SQLWrapper, values: TextEnum): SQL {
  const literals = values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`));
  return sql`${column} IN (${sql.join(literals, sql`, `)})`;
}
