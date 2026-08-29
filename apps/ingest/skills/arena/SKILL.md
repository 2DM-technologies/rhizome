# Are.na v3 channel ingestion

Version: `arena@1.0.0`

The parser accepts one UTF-8 JSON `arena-capture@1` OriginArtifact. The capture is a framed,
self-contained record of a public Are.na v3 channel fetch: exact channel-response bytes, ordered
contents-page bytes, and every approved asset body are retained as canonical base64 with the MIME
and final response URL that produced them. Each asset also retains its requested URL and the
ordered status/from/location/to provenance for every approved redirect hop. Parsing validates the
chain and never accesses the network.

Every available top-level Block becomes one `arena.block` candidate in ascending connection
position. Nested channels remain counted source records but are not traversed. Stable keys are
`arena_block_id` and `arena_channel_id`. Source properties preserve provider type, title,
description markdown, timestamps, connection ID/position/pinned state, connecting user, block
author, destination/source attribution, and relevant provider file/image metadata.

Payload mapping is closed and deterministic:

- `Text`: original Markdown UTF-8 bytes → one `text` / `text/markdown` content element.
- `Image`: captured original or declared Are.na rendition → one `image` content element.
- `Attachment`: captured attachment URL → one content element; validated MIME selects
  `image`, `audio`, `video`, or `document`.
- `Link` and `Embed`: destination URLs remain source properties. They produce no destination
  payload. A non-null Are.na image descriptor requires exactly one captured `image` preview
  element.

Provider HTML and extracted Link content are not elements and are not copied into source
properties. The importer does not crawl link/embed destinations. Element metadata includes role,
kind, MIME, exact byte size, `sha256:` content identity, filename, and final captured asset URL;
bytes remain available for reviewed staging by the server.
