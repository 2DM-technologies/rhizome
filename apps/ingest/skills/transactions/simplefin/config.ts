import { isIP } from "node:net";

export const DEFAULT_SIMPLEFIN_ALLOWED_HOSTS = [
  "bridge.simplefin.org",
  "beta-bridge.simplefin.org",
] as const;

const EXACT_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export interface SimpleFinSettings {
  allowedHosts: string[];
}

export function loadSimpleFinSettings(
  environment: Record<string, string | undefined> = process.env,
): SimpleFinSettings {
  const configuredHosts =
    environment.RHIZOME_SIMPLEFIN_ALLOWED_HOSTS ?? DEFAULT_SIMPLEFIN_ALLOWED_HOSTS.join(",");
  const allowedHosts = [
    ...new Set(
      configuredHosts
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (allowedHosts.length === 0) {
    throw new Error("RHIZOME_SIMPLEFIN_ALLOWED_HOSTS must contain at least one exact hostname");
  }
  for (const host of allowedHosts) {
    if (!EXACT_HOSTNAME_PATTERN.test(host) || isIP(host) !== 0) {
      throw new Error(
        "RHIZOME_SIMPLEFIN_ALLOWED_HOSTS accepts exact hostnames only; URLs, ports, IP addresses, and wildcards are forbidden",
      );
    }
  }

  return { allowedHosts };
}
