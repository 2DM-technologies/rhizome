# Are.na v3 boundaries

The parser may read only immutable `arena-capture@1` bytes supplied by the ingestion runtime. It
has no network, credential, filesystem, database, model, HTML-rendering, or script-execution access.

The skill connector owns Are.na URL normalization, bounded unauthenticated API GETs, timeouts,
response/page/block/asset byte limits, and framing the complete capture for owner-only immutable
OriginArtifact storage before parsing. The supplied page URL is a locator and is never fetched or
scraped. API redirects are rejected, and the only API origin is `https://api.are.na`.

Provider-declared asset URLs are delegated to the server-owned SafePublicFetcher boundary. The
skill has no direct asset-network fallback. That boundary accepts public HTTPS destinations on the
default port 443 only, blocks private and special networks after DNS resolution, pins the approved
resolution, manually revalidates every redirect, strips ambient credentials, and enforces byte,
time, redirect, and concurrency limits. The capture records the requested URL, every redirect
status/from/location/to tuple, and the final response URL so the deterministic parser can validate
provenance offline.

Private channels, OAuth, recursive nested-channel traversal, direct arbitrary URL fetching, link
crawling, provider embed HTML, and destination-page screenshots are outside this skill. Link and
embed URLs are inert provenance properties only.
