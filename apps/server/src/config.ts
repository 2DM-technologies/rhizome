export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authMode: "dev";
  baseUrl: string;
  blob:
    | { driver: "fs"; root: string }
    | {
        driver: "r2";
        endpoint: string;
        accessKeyId: string;
        secretAccessKey: string;
        buckets: Record<BlobNamespace, string>;
      };
}

export type BlobNamespace = "elements" | "origins" | "bundles" | "assets";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): ServerConfig {
  if (process.env.NODE_ENV === "production" && process.env.RHIZOME_AUTH_MODE === "dev") {
    throw new Error("Development authentication is forbidden in production");
  }
  const blobDriver = process.env.RHIZOME_BLOB_DRIVER ?? "fs";
  const blob: ServerConfig["blob"] =
    blobDriver === "r2"
      ? {
          driver: "r2",
          endpoint: required("R2_ENDPOINT"),
          accessKeyId: required("R2_ACCESS_KEY_ID"),
          secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
          buckets: {
            elements: process.env.R2_ELEMENTS_BUCKET ?? "elements",
            origins: process.env.R2_ORIGINS_BUCKET ?? "origins",
            bundles: process.env.R2_BUNDLES_BUCKET ?? "bundles",
            assets: process.env.R2_ASSETS_BUCKET ?? "assets",
          },
        }
      : { driver: "fs", root: process.env.RHIZOME_BLOB_FS_ROOT ?? ".rhizome/blobs" };

  if (blobDriver !== "fs" && blobDriver !== "r2") {
    throw new Error(`Unsupported RHIZOME_BLOB_DRIVER: ${blobDriver}`);
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/rhizome",
    authMode: "dev",
    baseUrl: (process.env.RHIZOME_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    blob,
  };
}
