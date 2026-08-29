# CSV boundaries

The parser may read only the immutable OriginArtifact bytes passed by the ingestion runtime. It has
no network, credential, filesystem, database, or model access. It returns candidate values only;
the server owns validation, review staging, and commit.
