# SimpleFIN v2 boundaries

The parser entrypoint may read only immutable OriginArtifact bytes supplied by the ingestion
runtime. It has no network, credential, filesystem, database, or model access.

The privileged SimpleFIN entrypoints in this skill own provider behavior: client and allowed-host
configuration, setup-token decoding and exchange, the `CredentialedSourceSkill` connector, Basic
Auth fetching, source-config normalization, account filtering, fetch limits, history planning, and
reviewed recovery policy. These entrypoints may use a credential only when the generic server
lifecycle supplies its decrypted secret for one reserved fetch.

`manifest.ts` is the serializable, data-only host contract: it declares safe input fields, versions,
review actions, and the single-use claim policy. `definition.ts` is the only executable bootstrap
export: it couples the manifest's stable skill ID to the settings loader and factory. The catalog
validates and freezes the manifest before publication.

The server owns only the provider-neutral `CredentialedSourceSkill` lifecycle: authentication and
ownership, replay-key fingerprinting and reservation, credential encryption and revocation, fetch
leases and enforcement of the skill's declared limit, durable capture storage, parser invocation,
VERIFY, and reviewed commit. It must store each successful raw response as an owner-only
OriginArtifact before invoking the parser; it must not branch on SimpleFIN or interpret an Access
URL.

Access URLs and credentials must never appear in parser input, stored source configuration,
candidates, VERIFY output, logs, or fixtures.
