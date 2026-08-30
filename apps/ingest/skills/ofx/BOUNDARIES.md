# QFX/OFX boundaries

The parser may read only the immutable OriginArtifact bytes passed by the ingestion runtime. It has
no network, credential, filesystem, database, or model access. It returns candidate values only;
the server owns validation, review staging, and commit.

`manifest.ts` is the skill's serializable host contract. It declares the file input, connector and
parser versions, and review capabilities without granting the host executable parser access.
