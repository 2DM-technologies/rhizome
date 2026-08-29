# Are.na v3 boundaries

The parser may read only immutable `arena-capture@1` bytes supplied by the ingestion runtime. It
has no network, credential, filesystem, database, model, HTML-rendering, or script-execution access.

The server connector owns URL normalization, bounded unauthenticated GETs, timeouts,
response/page/block/asset byte limits, and storage of the complete capture as an owner-only
OriginArtifact before parsing. API redirects are rejected. Asset redirects are followed manually
only through a capped chain of approved Are.na asset hosts; the capture records the requested URL,
each redirect status/from/location/to tuple, and the final response URL. M2 permits only the public
v3 channel and paginated contents endpoints on `api.are.na` and declared HTTPS assets on
`images.are.na`, `attachments.are.na`, or Are.na's fixed CloudFront distribution.

Private channels, OAuth, recursive nested-channel traversal, arbitrary URL fetching, link crawling,
provider embed HTML, redirects outside the approved asset hosts, and destination-page screenshots
are outside this skill. Link and embed URLs are inert provenance properties only.
