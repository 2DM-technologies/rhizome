# Are.na v3 channel ingestion

Version: `arena@1.2.0`

The parser accepts one UTF-8 JSON `arena-capture@1` OriginArtifact. The capture is a framed,
self-contained record of a public Are.na v3 channel fetch: exact channel-response bytes, ordered
contents-page bytes, and every approved asset body are retained as canonical base64 with the MIME
and final response URL that produced them. Each asset also retains its requested URL and the
ordered status/from/location/to provenance for every approved redirect hop. Parsing validates the
chain and never accesses the network.

Every available top-level Block from a current capture becomes one `arena.block` candidate in
Are.na's displayed board order (descending connection position). For reproducible replay under the
same pinned parser version, historical `position_asc` captures remain accepted and preserve their
captured order; the capture client always writes new artifacts with `position_desc`. Nested
channels remain counted source records but are not traversed. Stable keys are
`arena_block_id` and `arena_channel_id`. Source properties preserve provider type, title,
description markdown, timestamps, connection ID/position/pinned state, connecting user, block
author, destination/source attribution, and relevant provider file/image metadata.

Payload mapping is closed and deterministic:

- Every Block starts with one `text` / `text/plain` title element whose UTF-8 bytes exactly equal
  the canonical block title. If Are.na omits the title, the parser's deterministic fallback title
  is used. Its role is `title`, and it is always first.
- `Text`: original Markdown UTF-8 bytes → one `text` / `text/markdown` content element.
- `Image`: captured original provider-declared asset → one `image` content element. Resized renditions are
  accepted only as `Link` or `Embed` previews.
- `Attachment`: captured attachment URL → one content element; validated MIME selects
  `image`, `audio`, `video`, or `document`.
- `Link` and `Embed`: destination URLs remain source properties. They produce no destination
  payload. A non-null Are.na image descriptor requires exactly one safely-fetched `image` preview
  element.

Provider HTML and extracted Link content are not elements and are not copied into source
properties. The importer does not crawl link/embed destinations. Element roles are the closed set
`title`, `content`, and `preview`; captured network assets remain restricted to `content` and
`preview`. Element metadata includes role, kind, MIME, exact byte size, `sha256:` content identity,
filename, and final captured asset URL; bytes remain available for reviewed staging by the server.
