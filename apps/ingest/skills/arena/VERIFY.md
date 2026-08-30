# Are.na v3 VERIFY

The runtime must reject the preview or pull result unless every applicable check passes:

1. The public channel is available, its slug matches the capture URL, and its declared block,
   nested-channel, and total-content counts agree.
2. Captured contents pages are complete, sequential, agree on pagination and total count, and are
   strictly sorted in the direction attested by every page URL. New captures use Are.na's displayed
   board order (`position_desc`); historical `position_asc` artifacts remain replayable.
3. Candidate count equals the declared top-level Block count. At least one Block is required.
   Nested channels count as source records but never become candidates.
4. Every Block is available, supported, uniquely identified, and carries a unique connection
   position in the capture's attested order plus required author and timestamp metadata.
5. Every Block has exactly one first-position `title` element with `text/plain` UTF-8 bytes equal
   to its canonical title. Text, Image, and Attachment Blocks then each have exactly one content
   element. Link and Embed Blocks then have either no element or exactly one Are.na-hosted
   preview-image element.
6. Captured assets match their Block ID, role, requested Block URL, final approved-host response
   URL, validated redirect chain, and MIME. Image Block content must use its original asset URL;
   declared renditions remain valid only for Link and Embed previews. Required assets may not be
   omitted, and unreferenced or duplicate assets are rejected.
7. Every element has non-empty bytes, a matching exact byte size, a role- and kind-compatible
   MIME, and a SHA-256 that recomputes from its bytes.

The committed mixed fixture is synthetic and covers original Markdown, an image payload, a link
with an Are.na-hosted preview, and a PDF attachment.
