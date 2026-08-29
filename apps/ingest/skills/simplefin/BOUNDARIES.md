# SimpleFIN v2 boundaries

The parser may read only immutable OriginArtifact bytes supplied by the ingestion runtime. It has no
network, credential, filesystem, database, or model access.

Setup-token decoding, one-time token exchange, Access URL encryption, HTTPS host policy, Basic Auth,
rate limiting, and bounded `/accounts?version=2&start-date=…&end-date=…` fetching belong to the
server connector. The connector must store the raw response as an owner-only OriginArtifact before
invoking this parser. Access URLs and credentials must never appear in parser input, candidates,
VERIFY output, or fixtures.
