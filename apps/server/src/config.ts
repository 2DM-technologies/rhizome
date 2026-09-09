export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authMode: "dev";
  baseUrl: string;
  allowedOrigins: string[];
  maxRequestBodySize: number;
  blob: {
    driver: "r2";
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    buckets: Record<BlobNamespace, string>;
  };
}

/** The four buckets, enumerable so tooling can create them rather than restating the list. */
export const BLOB_NAMESPACES = ["elements", "origins", "bundles", "assets"] as const;
export type BlobNamespace = (typeof BLOB_NAMESPACES)[number];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): ServerConfig {
  const authMode = process.env.RHIZOME_AUTH_MODE ?? "dev";
  if (authMode !== "dev") throw new Error(`Unsupported RHIZOME_AUTH_MODE: ${authMode}`);
  if (process.env.NODE_ENV === "production" && authMode === "dev") {
    throw new Error("Development authentication is forbidden in production");
  }
  const baseUrl = (process.env.RHIZOME_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const maxRequestBodySize = Number(process.env.RHIZOME_MAX_REQUEST_BODY_BYTES ?? 52_428_800);
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0) {
    throw new Error("RHIZOME_MAX_REQUEST_BODY_BYTES must be a positive integer");
  }
  const allowedOrigins = (process.env.RHIZOME_ALLOWED_ORIGINS ?? new URL(baseUrl).origin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/rhizome",
    authMode,
    baseUrl,
    allowedOrigins,
    maxRequestBodySize,
    blob: {
      driver: "r2",
      endpoint: required("R2_ENDPOINT"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.R2_FORCE_PATH_STYLE === "true",
      buckets: {
        elements: process.env.R2_ELEMENTS_BUCKET ?? "elements",
        origins: process.env.R2_ORIGINS_BUCKET ?? "origins",
        bundles: process.env.R2_BUNDLES_BUCKET ?? "bundles",
        assets: process.env.R2_ASSETS_BUCKET ?? "assets",
      },
    },
  };
}
