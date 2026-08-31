# SimpleFIN v2 transaction ingestion

Version: `simplefin@2.0.0`

This committed parser accepts the raw UTF-8 JSON body from a SimpleFIN protocol v2 `/accounts`
response. The Account Set must contain `errlist`, `connections`, and `accounts`. Connections and
accounts are validated before transactions are emitted.

An account is identified by the composite `(conn_id, id)` because an account ID is unique only
within its Connection. A transaction ID is unique only within that composite account. The runtime
maps those values to `keys.simplefin_connection_id`, `keys.simplefin_account_id`,
`keys.simplefin_transaction_id`, `keys.fitid`, and a hash of the composite account identity.

Each transaction becomes one zero-element `transaction`. Stable SimpleFIN IDs, the account balance
snapshot, exact provider timestamps, pending state, and optional `extra` objects remain immutable
`source.properties`. Provider messages are never copied into candidates or VERIFY output.

Only ISO 4217 alpha currencies are supported because the rNet `transaction` vocabulary requires
them. SimpleFIN custom-currency URLs fail closed. An otherwise valid connected response with one or
more accounts and zero transactions is valid for a re-pull.

## Connected-source capability

This directory owns the complete SimpleFIN provider capability. `config.ts` validates the exact
HTTPS hosts the client may contact, `client.ts` performs bounded token exchange and Account Set
retrieval, and `source.ts` exposes the connector, fetch policy, configuration normalization,
account selection, history-window planning, and recovery behavior through
`CredentialedSourceSkill`. Provider unit tests and their synthetic captures remain colocated here.

The server consumes only the generic skill contract. It stores and protects opaque credential
secrets, reserves and records fetches, persists raw captures, and runs the shared reviewed-import
lifecycle without importing SimpleFIN request types or adding provider-specific service methods.
