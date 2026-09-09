# Metering payers and budgets

**Status:** Speculative. Not decided, not scheduled, not approved for implementation. See
[AGENTS.md](./AGENTS.md). This records a design that was part of the implementation plan and was
deliberately set aside for the alpha, so it can be picked up when real usage makes it necessary.

**Companion docs:** [implementation plan](../IMPLEMENTATION_PLAN.md) §3 (`meter_entry`), §6.2,
§7; [push pipeline](../concepts/push-pipeline.md) §8.

## 1. What the alpha does

The store pays for every metered run. Each `meter_entry` row is written with `payer = 'rhizome'`,
the store's own account, and nothing reads a dMachine manifest's `metering` block or enforces a
budget. Attribution is intact: `operations.invoked_by` records who triggered every run (`id:…`,
`client:…`, or `rhizome:{subsystem}`), so per-user and per-dMachine cost are one query grouped by
`invoked_by`. The per-run ceilings on a push (calls, tokens, wall clock) bound any single run.

This is enough while usage is small and every dMachine is first-party. It stops being enough the
moment a third-party dMachine can spend on a user's Vibe, or a user's monthly spend needs a cap.

## 2. The concept

Who _caused_ a run and who _pays_ for it are different questions, and they differ routinely. A
dMachine may declare that its developer absorbs inference cost (a free app) or that the user who
granted it pays (a metered app). Both must be answerable: "what does rBudget cost across all
users" and "what did this user spend, by dMachine". `meter_entry.payer` exists for the second
question; `operations.invoked_by` answers the first.

## 3. The shape that was planned

### 3.1 Manifest declaration

```ts
metering: { payer: "developer" | "user"; budget_usd_per_user_month?: number };
```

Declared statically in the dMachine manifest (plan §7), read by the store, never trusted from the
client at request time.

### 3.2 Payer resolution at accept

| Invoker                 | `manifest.metering.payer` | `meter_entry.payer`                  |
| ----------------------- | ------------------------- | ------------------------------------ |
| user (owner or grantee) | n/a                       | `actor.subject`                      |
| client                  | `developer`               | `client:{name}`                      |
| client                  | `user`                    | `id:rnet://id/{vibe owner}`          |
| client                  | missing or invalid        | rejected before any row exists (422) |

Resolved synchronously before the operation row is inserted, so an unattributable run never
spends. The `user` branch is the first place a dMachine spends someone else's money, which is why
it was held until budgets exist.

### 3.3 Budgets and cost consent

- A server-enforced hard cap from `budget_usd_per_user_month`, checked at accept against the
  payer's month-to-date sum over `meter_entry`.
- The SDK's `usage.current()` and `usage.onCost` (plan §7) so a dMachine can show spend, and a
  host-rendered cost indicator the dMachine cannot suppress.
- Operation results expose `usage` to the payer as well as the owner, since the party that pays may
  see what it paid.

### 3.4 What it touches when picked up

`metering/payer.ts` (resolution), the push accept step, a `metering_unconfigured` problem code,
the operation serializer's usage visibility, the seed (a dev client manifest with a `metering`
block), and the SDK usage surface. No schema change: `meter_entry.payer` already has the right
shape and grammar.

## 4. Open questions

- Whether a grantee user (not the owner) who invokes a push pays themselves or the owner.
- Whether budgets are per payer per month or per Vibe.
- Whether a dMachine may switch from developer-pays to user-pays after users have granted it.
