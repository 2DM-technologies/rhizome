# Are.na v3 VERIFY

The runtime must reject the preview or pull result unless every applicable check passes:

1. The public channel is available, its slug matches the capture URL, and its declared block,
   nested-channel, and total-content counts agree.
2. Captured contents pages are complete, sequential, sorted by ascending connection position, and
   agree on pagination and total count.
3. Candidate count equals the declared top-level Block count. At least one Block is required.
   Nested channels count as source records but never become candidates.
4. Every Block is available, supported, uniquely identified, and carries a unique ascending
   connection position plus required author and timestamp metadata.
5. Text, Image, and Attachment Blocks each have exactly one content element. Link and Embed Blocks
   have either no element or exactly one Are.na-hosted preview-image element.
6. Captured assets match their Block ID, role, requested Block URL/rendition, final approved-host
   response URL, validated redirect chain, and MIME. Required assets may not be omitted and
   unreferenced or duplicate assets are rejected.
7. Every element has non-empty bytes, a matching exact byte size, a kind-compatible MIME, and a
   SHA-256 that recomputes from its bytes.

The committed mixed fixture is synthetic and covers original Markdown, an image payload, a link
with an Are.na-hosted preview, and a PDF attachment.
