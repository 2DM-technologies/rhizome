import { isIP } from "node:net";

type ParsedCidr = readonly [network: bigint, prefixLength: number];

/**
 * IPv4 ranges that must never be reachable through the public-fetch boundary.
 *
 * This deliberately includes globally reachable protocol-assignment ranges such as AS112 and
 * AMT. They are special-purpose infrastructure rather than ordinary public content origins, and
 * denying them is the safer default for a server-side fetch primitive.
 */
const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.31.196.0/24",
  "192.52.193.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "192.175.48.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

/** Current allocated global-unicast prefixes from IANA's 2025-10-10 registry. */
const ALLOCATED_IPV6_CIDRS = [
  "2001::/23",
  "2001:200::/23",
  "2001:400::/23",
  "2001:600::/23",
  "2001:800::/22",
  "2001:c00::/23",
  "2001:e00::/23",
  "2001:1200::/23",
  "2001:1400::/22",
  "2001:1800::/23",
  "2001:1a00::/23",
  "2001:1c00::/22",
  "2001:2000::/19",
  "2001:4000::/23",
  "2001:4200::/23",
  "2001:4400::/23",
  "2001:4600::/23",
  "2001:4800::/23",
  "2001:4a00::/23",
  "2001:4c00::/23",
  "2001:5000::/20",
  "2001:8000::/19",
  "2001:a000::/20",
  "2001:b000::/20",
  "2002::/16",
  "2003::/18",
  "2400::/12",
  "2410::/12",
  "2600::/12",
  "2610::/23",
  "2620::/23",
  "2630::/12",
  "2800::/12",
  "2a00::/12",
  "2a10::/12",
  "2c00::/12",
] as const;

/** Special-purpose ranges that overlap allocated IPv6 global-unicast prefixes. */
const BLOCKED_GLOBAL_IPV6_CIDRS = [
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "2620:4f:8000::/48",
  "3fff::/20",
] as const;

const PARSED_BLOCKED_IPV4_CIDRS = BLOCKED_IPV4_CIDRS.map(parseIpv4Cidr);
const PARSED_ALLOCATED_IPV6_CIDRS = ALLOCATED_IPV6_CIDRS.map(parseIpv6Cidr);
const PARSED_BLOCKED_GLOBAL_IPV6_CIDRS = BLOCKED_GLOBAL_IPV6_CIDRS.map(parseIpv6Cidr);

/**
 * Returns whether an IP literal is suitable for a server-owned public HTTPS request.
 *
 * The check is intentionally fail-closed. Malformed addresses and all unallocated or
 * special-purpose ranges are rejected. IPv4-mapped IPv6 addresses are always rejected; this both
 * honors their reserved-by-protocol status and prevents forms such as `::ffff:127.0.0.1` from
 * bypassing the IPv4 policy.
 */
export function isSafePublicIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address.trim());
  const family = isIP(normalized);
  if (family === 4) {
    const value = parseIpv4(normalized);
    return value !== undefined && isSafeIpv4(value);
  }
  if (family !== 6) return false;

  const value = parseIpv6(normalized);
  if (value === undefined) return false;

  // The first 96 bits of an IPv4-mapped address are ::ffff.
  if (value >> 32n === 0xffffn) return false;

  if (!PARSED_ALLOCATED_IPV6_CIDRS.some((cidr) => isInCidr(value, 128, cidr))) return false;
  return !PARSED_BLOCKED_GLOBAL_IPV6_CIDRS.some((cidr) => isInCidr(value, 128, cidr));
}

function isSafeIpv4(value: bigint): boolean {
  return !PARSED_BLOCKED_IPV4_CIDRS.some((cidr) => isInCidr(value, 32, cidr));
}

function parseIpv4Cidr(cidr: string): ParsedCidr {
  const [address, encodedPrefix] = cidr.split("/");
  const network = address === undefined ? undefined : parseIpv4(address);
  const prefixLength = Number(encodedPrefix);
  if (
    network === undefined ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > 32
  ) {
    throw new Error(`Invalid internal IPv4 CIDR: ${cidr}`);
  }
  return [network, prefixLength];
}

function parseIpv6Cidr(cidr: string): ParsedCidr {
  const [address, encodedPrefix] = cidr.split("/");
  const network = address === undefined ? undefined : parseIpv6(address);
  const prefixLength = Number(encodedPrefix);
  if (
    network === undefined ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > 128
  ) {
    throw new Error(`Invalid internal IPv6 CIDR: ${cidr}`);
  }
  return [network, prefixLength];
}

function isInCidr(
  value: bigint,
  addressBits: number,
  [network, prefixLength]: ParsedCidr,
): boolean {
  if (prefixLength === 0) return true;
  const shift = BigInt(addressBits - prefixLength);
  return value >> shift === network >> shift;
}

function parseIpv4(address: string): bigint | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    result = (result << 8n) | BigInt(octet);
  }
  return result;
}

function parseIpv6(address: string): bigint | undefined {
  let normalized = address.toLowerCase();
  if (normalized.includes("%")) return undefined;

  const lastColon = normalized.lastIndexOf(":");
  const ipv4Tail = normalized.slice(lastColon + 1);
  if (ipv4Tail.includes(".")) {
    const ipv4 = parseIpv4(ipv4Tail);
    if (ipv4 === undefined) return undefined;
    normalized = `${normalized.slice(0, lastColon + 1)}${(ipv4 >> 16n).toString(16)}:${(
      ipv4 & 0xffffn
    ).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = parseIpv6Words(halves[0] ?? "");
  const right = parseIpv6Words(halves[1] ?? "");
  if (left === undefined || right === undefined) return undefined;

  const hasCompression = halves.length === 2;
  const omittedWords = 8 - left.length - right.length;
  if ((!hasCompression && omittedWords !== 0) || (hasCompression && omittedWords < 1)) {
    return undefined;
  }

  const words = hasCompression ? [...left, ...Array<number>(omittedWords).fill(0), ...right] : left;
  if (words.length !== 8) return undefined;
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function parseIpv6Words(value: string): number[] | undefined {
  if (value === "") return [];
  const words = value.split(":");
  const parsed: number[] = [];
  for (const word of words) {
    if (!/^[0-9a-f]{1,4}$/.test(word)) return undefined;
    parsed.push(Number.parseInt(word, 16));
  }
  return parsed;
}

function stripIpv6Brackets(address: string): string {
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}
