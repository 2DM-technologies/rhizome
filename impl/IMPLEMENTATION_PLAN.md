# rNet × Rhizome — Implementation Plan

**For coding agents. Single source of truth for the build. Read this whole file before writing code.**

Companion artifacts (canonical, do not re-derive from memory):
- `../../rnet/spec/rnet-spec-v0.1.md` — the protocol specification. Its text wins on protocol questions.
- `../../rnet/schemas/0.1/` — eight validated JSON Schema files. They win on shape questions once brought in sync with the spec.
- This file wins on implementation, stack, milestones, and scope.

---

## 1. What is being built

**rNet** is an open protocol for "Vibe-based Computing": a standardized interface between media curated by users and AI-powered applications. **Rhizome** is the product implementing it.

See the write up here for a expository starting place: https://noahputnam.computer/portfolio. Note it's not fully up to date relative to the rest of this spec. Use this spec as a source of truth for what vibe based computing is.

Core objects (defined fully in the spec + schemas):

- **MediaElement** — immutable, UUIDv7-identified atomic content record: an immutable `owner`, a payload, and contextual metadata. Five kinds (`text|image|audio|video|document`), closed set, rule: *a kind exists iff a human consumes that thing directly*. URI: `rnet://element/{uuid}`; the payload is independently identified by required `content_hash`.
- **OriginArtifact** — immutable, UUIDv7-identified provenance record around raw uploaded bytes (bank export, data dump), with an immutable `owner`. URI: `rnet://origin/{uuid}`; the payload is independently identified by required `content_hash`. Ontologically inert: not media, never inside a Vibe, never model-consumed. **Every raw upload is an origin, never an element.** Exists so ingestion can always re-run against ground truth.
- **MediaObject** — owned unit of meaning. Fields: immutable `owner`, `type` (open vocabulary; registered: `transaction`, `track`; reserved: `post`, `photo`, `note`, `contact`, `event`, `book`, `article`, `receipt`), zero-or-more element refs, `keys` (global identifiers: fitid, isrc…), and three property blocks:
  - `source` — written by ingestion only, immutable; contains the `ingest` record, `origins` refs, and properties.
  - `user` — owner-mutable, revision-protected (If-Match).
  - `inferred` — model-written via push; **memory scoped to the record**, as a map keyed by writer and task — the store's analyses under `rhizome:` (`rhizome:categorize`), a machine's under its registered name (`rbudget:forecast`). Machine names are globally unique, so keys cannot collide. Each entry carries its own `model`, `inferred_at`, optional `confidence`, `properties`. **Not all of it is recomputable:** task output is, but a user's correction or a pattern an agent noticed across several objects is not — those entries set `durable: true` and a push task must never replace them. A task cannot set the flag on its own output — `durable` means *cannot be reproduced by re-running*, which task output is by definition — so only agent runs and user-driven writes set it. Otherwise a re-run replaces only its own key. Advisory, re-derivable, deletable.
  - `x-*` namespaced extensions are legal everywhere; unnamespaced extras are schema violations.
- **Vibe** — owned, living collection of object *references*. Has `pull` config, `grants` (ACL), and a Vibe-level `inferred` block with the same task-keyed shape (conventional properties still settling; the `summarize` task writes something like `summary` and `tags`). Vibes have no `source` block — they are authored, not ingested.

### Doctrines

Violating these is wrong, not a style choice. Revert.

1. **Fields are values; elements are files.** A field is a value you would put in a database column (a transaction's description, a track's title). An element is a byte payload with a MIME type you must fetch to render (a photo, a PDF, the prose body of a note). The test: **if you would query on it, it is a field; if you would open it, it is an element.** The `text` kind is for prose, not strings — length is not the axis. Objects whose meaning is entirely factual carry zero elements; that's normal, not degenerate.
   **Record identity and payload identity are separate.** Elements and origins have UUIDv7 primary keys and immutable records; their bytes are content-addressed by `content_hash`. More than one record may share a payload. Deduplication is internal storage behavior.
2. **Grants are store-enforced, never client-honor-system.** Scopes: `read`, `write:user`, `write:objects`, `write:inferred`, `push`, `pull` — grants are owner-set, and no scope delegates the ability to grant. **Origins are owner-only and not delegable by any scope** — a raw export is strictly more revealing than the objects parsed from it. `pull` invokes already-configured sources and cannot rewrite pull config. `write:user` cannot touch `source`, `inferred`, `keys`, `type`, or `elements`.

   **`write:objects`** lets a machine create objects — the authoring case (a notes machine, a journal, a photo-tagger). Authored objects carry `source.ingest.method: "authored"` and an origin naming the creating machine (`rnet://client/{uuid}`). **Grounding is uniform: every object has at least one origin, always** — either a file it was parsed from or the machine it was made in. The `source` block's rule is *written at creation, immutable after*; ingestion is one way an object comes to be, authoring is another. Identifiers are not capabilities: a machine may attach only an object it created for the target Vibe, and may attach an element only when that element is already readable through the target Vibe or was created for it under the same `write:objects` grant. Knowing a UUID or `content_hash` is never sufficient. Reusing a pre-existing object across Vibes is owner-only, even when both Vibes have the same owner.

   **`write:inferred`** lets a machine persist its own model output without a server-mediated push. **Task keys are `{writer}:{task}`, uniformly** — the store writes `rhizome:categorize`, a machine writes `rbudget:forecast`. The store enforces that a machine's writer prefix is its own registered name, so nothing can write under another's namespace. Machine names are already `UNIQUE` in the `machines` table, which is what makes the guarantee hold; the reserved-name list at registration must include `rhizome` alongside `admin`, `api`, `root`, `system`.
3. **Determinism is disclosed, not assumed.** Every object's `source.ingest` declares a `method` — `parser` (committed parser ran), `generated_parser` (agent wrote a one-off parser, `parser_hash` pins it), `agent` (agent extracted directly, no parser), `authored` (a person made it in a client) — plus `reproducible`. The ladder is `parser` > `generated_parser` > `agent`: generated code is hash-pinned and re-runnable, freehand extraction never is, so `agent` runs are always `reproducible: false`.
4. **Element kinds name consumption; object types name meaning.** Neither taxonomy may borrow from the other. A PDF is a `document` element; the object holding it is a `receipt` or an `article`.
5. **Intelligence at read time.** Schemas are dumb honest containers. Semantics are inferred by models, not encoded by authors.
6. **The protocol is what two strangers must agree on to share a store.** Test for protocol membership: would two independent stores that disagreed on this fail to interoperate? If no, it belongs in the product, not the spec.

---

## 2. Repo topology

Two repos. **The dependency arrow points one way: `rhizome` imports from `rnet`, never the reverse.** If `rnet` needs something from `rhizome`, that thing is either actually protocol (move it) or a design error. See `~/2dm` for local repos.

```
rnet/                               # OPEN (Apache-2.0). The protocol.
├── spec/rnet-spec-v0.1.md          # v0.1 spec (copy in verbatim)
├── schemas/0.1/                    # the 8 JSON Schema files (copy in verbatim)
│   ├── media-element.json  media-object.json  origin-artifact.json
│   ├── vibe.json  ingest-record.json  grant.json
│   └── types/  transaction.json  track.json
├── packages/
│   ├── types/                      # @rnet/types — TS types + Zod, GENERATED from schemas/
│   │   ├── codegen/                # build-time pipeline (see M0)
│   │   └── src/                    # generated output, committed
│   └── conformance/                # @rnet/conformance — certification suite
│       ├── fixtures/               # valid + invalid examples (plan §9)
│       └── src/                    # runnable: conformance run --target <url>
└── README.md

rhizome/                            # PRODUCT (closed).
├── impl/
│   ├── IMPLEMENTATION_PLAN.md      # this file; sole implementation plan
│   ├── CONFORMANCE.md              # living list of intentional spec gaps
│   └── concepts/                   # settled design notes not tied to one milestone
│       └── sandboxing.md           # alpha isolation + bridge decision
├── apps/                           # what Rhizome deploys
│   ├── server/                     # the rNet store — Bun + Hono
│   │   └── src/ routes/ db/ blobs/ push/ pull/ auth/ metering/
│   │       └── push/tasks/         # one dir per task: prompt + output schema (plan §5.1)
│   ├── host/                       # the Rhizome shell — Vite + React SPA, React Router.
│   │                               # Holds the session, talks to the store directly, and
│   │                               # renders the sandbox iframes that machines/ run inside.
│   │                               # NOT a machine: it is the container, not a guest.
│   └── ingest/
│       ├── skills/                 # ingestion skills (plan §5.2)
│       ├── verify/                 # invariant runner (executes skills' VERIFY.md)
├── machines/                       # what runs in the sandbox — dMachine implementations.
│   │                               # First-party machines get no privileges a
│   │                               # third-party machine wouldn't get (plan §6).
│   ├── rbudget/                     # rBudget dMachine — React + Vite, no router
│   └── maker/                      # the dMachine that makes dMachines (M6)
│       └── templates/              # rbudget/ is template #1
├── packages/
│   ├── harness/                    # @rhizome/harness — Pi RPC wrapper, subprocess-per-job.
│   │                               # TWO consumers, neither owns it: apps/ingest (parsers,
│   │                               # write edge) and the server's agent.* endpoints
│   │                               # (machines, read edge). This is what makes "one runtime,
│   │                               # two factories" structural rather than rhetorical.
│   ├── client/                     # @rhizome/client — typed SDK over the rNet API
│   └── dmachine-sdk/               # M4: @rhizome/dmachine-sdk — the machine contract (plan §7)
│                                   # OPEN SOURCE (Apache-2.0), published to npm
└── infra/                          # Railway (app + Postgres) + R2 buckets
```

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Bun** | TS direct, fast SHA-256 (payload hashing is on the hot path). **`@rnet/*` packages must stay isomorphic** — web standards only (`fetch`, WHATWG streams), no `node:`/Bun imports — because they are published to npm and imported by *clients*, including machines running in browsers; a stray `node:fs` import breaks web bundling. This costs nothing in practice: `@rnet/types` is generated validators with no I/O at all, and `@rnet/conformance` is HTTP plus JSON comparison. The one exception is the conformance CLI, which needs `process.argv` — keep the suite an importable library and put the CLI in a separate entry point. The constraint does **not** apply to `@rhizome/harness` or the server, which are unapologetically server-side. |
| HTTP | **Hono** + `@hono/zod-validator` | One Zod definition per route → validation + types (+ OpenAPI later). |
| Validation | **Zod derived from JSON Schema** — pending the M0 spike | Schemas are the source of truth; nobody hand-edits generated files. If `json-schema-to-zod` mangles the `if/then` conditionals or the `patternProperties` + `additionalProperties:false` combination, fall back to (a) **ajv** executing schemas natively + `json-schema-to-ts` for static types, or (b) hand-written Zod with a CI test asserting equivalence against shared fixtures. Fidelity beats DX. |
| DB | **Postgres via Drizzle** | `source`, `user`, `inferred`, `keys`, and `pull_config` are `JSONB` and get queried *inside* — `inferred->'rhizome:categorize'->>'category'`, GIN indexes on `keys` — which is the main reason for Postgres. `TIMESTAMPTZ`, `CHECK` constraints, and partial indexes cover the rest. Managed by Railway in the same project. |
| Blobs | **Cloudflare R2 (S3 API), four buckets: `elements`, `origins`, `bundles`, `assets`** — from M1 | One `BlobStore` interface; filesystem implementation for offline dev/tests only. Element and origin records live in Postgres; their payloads use the bare `content_hash` as the object key (`sha256:{hash}`). Multiple UUID records may therefore reuse one stored payload. No directory sharding; that is a filesystem habit and object stores have no directories. `bundles` holds every machine's built code — first-party uploaded at deploy, generated at creation — so the sandbox loader has one path and no static-asset special case. `assets` holds product chrome (avatars and the like), kept out of `elements` so the protocol's media graph stays free of things no object references. DB replication and blobs both land in R2: one durability story, no backup jobs to write. |
| Agent harness | **Pi**, RPC mode, subprocess-per-job | Behind a `Harness` interface (Claude Agent SDK is the fallback). Skill format is ours; a thin adapter registers skills with Pi. **The harness is platform infrastructure, not an ingest-only tool:** it is exposed to dMachines through the SDK (`agent.session` / `agent.stream` + `<AgentSurface>`, §7) with the same scope and metering enforcement as any other call. Machines get agentic capability without shipping their own keys or runtime. **Pi owns model execution for agent runs — don't wrap its provider layer** — but normalize at two edges so the two systems can't drift: one config source sets both the `ModelConnector` and Pi's providers, and Pi's reported usage maps into the same `meter` rows as direct calls. Pi executes; we own naming and accounting.<br><br>**The metering seam:** the harness *measures* (only it sees Pi's per-turn token counts) and *enforces ceilings live* (`maxTokens`, `maxTurns`, `maxWallClock` — a runaway loop must be killable mid-run; checking a budget before spawn and after return is useless when turn 40 is where the money goes). The server owns *policy* — whose budget, monthly caps, dollar rates, which line item — and writes the `meter` row. Job spec in carries the ceiling; the result carries `{tokensIn, tokensOut, turns, durationMs, abortReason?}`. The harness never reads a budget table, never knows a rate, never decides who pays. That keeps its two consumers symmetric: ingestion and machine agent runs get ceilings from different policy paths and are executed identically. It also knows nothing about Vibes or scopes — those checks stay in the server. |
| Inference | **Model-agnostic.** `ModelConnector` interface; **first connector: OpenAI**; second connector chosen at M5 by measurement | The platform is not captive to one vendor. Push targets are provider-qualified: `model:{provider}/{name}` (e.g. `model:openai/gpt-5.6-luna`). A connector implements `complete` / `stream` / `countTokens` / `reportCost` — deliberately narrow. **`complete` is schema-constrained:** it takes a JSON Schema and the connector hands it to whatever the provider calls that feature (OpenAI structured outputs, Anthropic tool-use-as-output), so output is constrained at generation rather than parsed out of prose. The connector re-validates before returning. Where the schema comes from differs by caller: ingestion validates against `media-object.json` and its type vocabulary; push tasks bring their own (plan §5.1). The push pipeline, the harness, and the SDK's `agent.*` all call `ModelConnector` — never a vendor SDK directly — so swapping providers touches one file.<br><br>**Model defaults (OpenAI rate card, verified from developers.openai.com):**<br>• **Push → `gpt-5.6-luna`, batch or flex tier: $0.10 in / $0.60 out per 1M** (standard $0.20/$1.20, halved). Categorization is asynchronous by nature, so the discount applies cleanly; a few thousand transactions a month costs cents. Flex is the same rate as batch but synchronous — likely the better fit if results should land in seconds rather than within 24h.<br>• **Harness → `gpt-5.6-sol`: $5 in / $30 out.** Also test **`gpt-5.3-codex` ($1.75 / $14)** at M5 — parser generation is literally a coding task, and it is 3× cheaper on output.<br>• **Long context is a cliff, not a slope.** Above the long-context threshold every rate roughly doubles (Sol → $10/$45, Luna → $0.40/$1.80). The harness's `maxTokens` ceiling therefore has a cost step in it; set it below the threshold deliberately rather than by accident.<br>• **Avoid Fast mode** (Sol $10/$60) unless latency becomes a product problem.<br>• **Do not use OpenAI's hosted Shell / Code Interpreter containers** ($0.03–$1.92 per 20-minute session by memory size). `@rhizome/harness` runs its own Pi subprocess; reaching for the hosted option would add a second sandbox with its own billing.<br><br>Every token metered from the first push. Rate cards move — re-verify against the provider's own pricing page before any number goes in a budget. |
| Frontend (`apps/host`) | **Vite + React SPA, React Router (declarative mode), TanStack Query** | The Rhizome shell only — auth, vibe list, consent dialogs, `AgentSurface`, the sandbox container. No SSR: static build, one deployable, and React Router in declarative mode (not framework mode). Docs site at M7 is a separate static generator (Astro/Nextra), not this app.<br><br>**The host is an OS shell, not a page.** The mockups are explicit about this: a persistent dock with global search, an agent sidebar streaming messages and tool-call blocks, and a "start something new" surface spanning creation and import flows — with several machines live at once. Plan for that shape from M1 rather than retrofitting it.<br><br>State splits three ways: **TanStack Query owns server state** (vibes, objects, operations, usage — it needs caching, invalidation, and polling for `ops.watch`); **Better Auth's hook owns session**; **Zustand owns shell state** — which machines are open and focused, dock state, agent sidebar visibility and stream buffer, pending grant requests, live cost, command palette. That last category is genuinely cross-cutting, long-lived, and mutated from many places at once, which is exactly what a store is for and what prop-drilling through a shell makes miserable. The sandbox *bridge* — postMessage plumbing, per-iframe connection status, pending request queues — lives in the SDK's event emitter and feeds the store. State *inside* a machine is the machine's own business, in its own bundle; the host never sees it. |
| Machines | **Vite + React, static bundle, no router** | A machine is a single view mounted in a sandboxed iframe: no server, no SSR, no routes — internal navigation is local state. `machines/rbudget` talks only through `@rhizome/dmachine-sdk`, inside the sandbox, using zero private APIs — it must be buildable by an outsider with the public surface alone. |
| Auth | **Phone OTP: Better Auth + Twilio Verify**, passkey enrolled on first session | Phone is a credential, never an identity: `rnet://id/{uuid}`. The phone number must never appear in any URI, owner field, or grant; the users table has no phone column by construction. Use Twilio **Verify** (not raw SMS — avoids A2P 10DLC registration). Fraud Guard on, rate-limit sends per-number and per-IP, US/CA geo-fence at launch. Dev mode: magic code `000000`, Twilio stubbed.<br><br>**Usernames are a store feature, not a protocol one** — same category as the phone number. Identity is `rnet://id/{uuid}`, always, everywhere: `owner` columns, grant subjects, and revision actors store the uuid and never the handle, so a rename is a row update that breaks no references. The handle travels *alongside* the id in API responses (`{ id, handle }`), never *as* it — a URI that changes when someone renames would make two strings identify the same thing depending on when you looked. At registration: casefold, reject homoglyph-confusable variants (`n0ah` impersonating `noah` in a grant list is a real attack), and reserve `admin`, `api`, `root`, `rnet`, `rhizome`, `system`, `me`, `settings`, `new` before anyone takes them. |
| Deploy | **Railway**, single deployable (server + ingest) + managed Postgres | Git-push deploys, no Docker authoring, Postgres in the same project, and a subprocess-spawning harness runs without special handling. |

### Data model (Postgres, via Drizzle)

> **First draft.** These definitions will change, in places significantly, as implementation proceeds. Treat them as the intended shape, not a migration to run.

JSON columns are `JSONB`. Timestamps are `TIMESTAMPTZ`.

**Record identity and payload identity are separate.** Every top-level stored record in Rhizome uses a **UUIDv7** primary key (time-sortable like a ULID, but a native 16-byte Postgres type with better index locality). Element and origin records are immutable except for tombstoning. Their `content_hash` is a SHA-256 over the payload, not a primary key and not a capability; it may repeat across rows. Mutable objects and Vibes retain identity while their revisioned content changes.

**Record ownership is explicit in both protocol and storage, not inferred from Vibe membership.** Origins, elements, objects, and Vibes carry required immutable `owner` URIs on the wire; Rhizome stores their local identifiers as `owner_uuid`. A record may be temporarily unattached or referenced by several Vibes, so joins cannot answer who may administer, tombstone, or garbage-collect it. A machine-created element or object inherits the owner of the Vibe that authorized the write. `created_by` remains separate audit data identifying the actor, while Vibe membership and grants continue to determine delegated read/write access. For v0.1, an object's owner must match its Vibe, its elements, and any OriginArtifacts in its provenance; cross-owner references wait for sharing semantics.

**`updated_at` only where there is no revision log.** `objects` and `vibes` carry rev counters and write to `object_revisions` / `vibe_revisions` on every mutation, so "when did this change" is answered more precisely — and with *what* changed and *who* changed it — by the log. `origins` and `elements` are immutable (only tombstoned). `machines` has no log, so it carries `updated_at`. `users` carries both: `updated_at` for editable fields, and `user_revisions` for `inferred`, because memory is not recomputable and an accidental clear must be recoverable.

**Every stored document records its version.** `rnet_schema` is on origins, elements, objects, and vibes without exception — a short column on rows you are writing anyway, and the alternative is a carve-out that has to be justified and will eventually be justified wrongly. Note that record metadata is *not* fully re-derivable from the bytes: `label` is the filename the user handed over, `uploaded_at` is when they did it, and `mime` cannot be reliably sniffed. Only `content_hash` and `byte_size` come from the content.

**Blobs are not in Postgres.** Origin and element rows carry record metadata plus `content_hash`; payload location is derived from bucket + `content_hash`, and the API generates the retrievable `bytes` URL on read. Machine bundles and product assets also live in R2. Payload garbage collection is reference-aware: deleting one UUID record must not remove bytes still used by another live record.

```sql
-- ══ Immutable payload-backed records ════════════════════════════════
-- These tables carry RECORD METADATA ONLY — there is no bytes column.
-- Payloads live in R2 under content_hash. content_hash is deliberately not
-- unique: distinct records may share bytes while retaining distinct context.
CREATE TABLE origins (                  -- provenance records: raw exports, API responses
  uuid          UUID PRIMARY KEY,       -- UUIDv7; the rnet://origin/{uuid}
  owner_uuid    UUID NOT NULL REFERENCES users(uuid),
  content_hash  TEXT NOT NULL,           -- sha256:{hash}; R2 key, never a capability
  mime          TEXT NOT NULL,
  byte_size     BIGINT NOT NULL,
  label         TEXT,                    -- original filename or source label
  rnet_schema   TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL,
  tombstoned_at TIMESTAMPTZ              -- non-null = record tombstoned (spec §6.3)
);
CREATE INDEX origins_content_hash_idx ON origins(content_hash);

CREATE TABLE elements (                 -- media records: what a human consumes
  uuid          UUID PRIMARY KEY,       -- UUIDv7; the rnet://element/{uuid}
  owner_uuid    UUID NOT NULL REFERENCES users(uuid),
  content_hash  TEXT NOT NULL,           -- sha256:{hash}; R2 key, never a capability
  kind          TEXT NOT NULL CHECK (kind IN ('text','image','audio','video','document')),
  mime          TEXT NOT NULL,
  byte_size     BIGINT NOT NULL,
  rnet_schema   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  created_by    TEXT NOT NULL,           -- authenticated user/client URI; internal audit
  created_for_vibe UUID REFERENCES vibes(uuid), -- required for client uploads; internal scope
  tombstoned_at TIMESTAMPTZ
);
CREATE INDEX elements_content_hash_idx ON elements(content_hash);

-- ══ Objects ══════════════════════════════════════════════════════════
CREATE TABLE objects (
  uuid          UUID PRIMARY KEY,       -- UUIDv7; the rnet://object/{uuid}
  owner_uuid    UUID NOT NULL REFERENCES users(uuid),
  created_by    TEXT NOT NULL,          -- authenticated user/client URI; internal audit
  created_for_vibe UUID REFERENCES vibes(uuid), -- required for client-created objects
  type          TEXT NOT NULL,          -- transaction|track|note|receipt|… (open vocab)
  keys          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {isrc, fitid, url, …}
  source        JSONB NOT NULL,         -- {ingest, origins, properties, retrieved_at}
  source_rev    INTEGER NOT NULL DEFAULT 1,
  "user"        JSONB,                  -- {properties, updated_at} | NULL. Reserved word:
                                        -- Drizzle quotes it automatically, but in raw SQL
                                        -- `SELECT user` silently returns CURRENT_USER.
  user_rev      INTEGER NOT NULL DEFAULT 0,   -- 0 = never written; If-Match compares this
  inferred      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {writer}:{task} keyed map
  extensions    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- x-* namespaced
  rnet_schema   TEXT NOT NULL,          -- protocol version this row was written under
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX objects_type_idx ON objects(type);
CREATE INDEX objects_keys_idx ON objects USING GIN (keys jsonb_path_ops);
CREATE INDEX objects_inferred_idx ON objects USING GIN (inferred jsonb_path_ops);

CREATE TABLE object_elements (          -- ordered element refs
  object_uuid   UUID NOT NULL REFERENCES objects(uuid) ON DELETE CASCADE,
  element_uuid  UUID NOT NULL REFERENCES elements(uuid),
  position      INTEGER NOT NULL,
  PRIMARY KEY (object_uuid, position)
);

-- Grounding: uniform, always ≥1 row per object. Two nullable FK columns rather
-- than a polymorphic (kind, ref) pair, so Postgres enforces referential
-- integrity on the provenance link instead of the application doing it by
-- convention. "Every object points at what it came from" is the invariant the
-- whole grounding rule rests on — worth two columns to have the database hold it.
CREATE TABLE object_origins (
  object_uuid   UUID NOT NULL REFERENCES objects(uuid) ON DELETE CASCADE,
  artifact_uuid UUID REFERENCES origins(uuid),    -- set when ingested from an artifact
  machine_uuid  UUID REFERENCES machines(uuid),   -- set when authored in a client
  CHECK (num_nonnulls(artifact_uuid, machine_uuid) = 1),
  UNIQUE (object_uuid, artifact_uuid, machine_uuid)
);
CREATE INDEX object_origins_object_idx ON object_origins(object_uuid);

-- ══ Vibes ════════════════════════════════════════════════════════════
CREATE TABLE vibes (
  uuid          UUID PRIMARY KEY,       -- UUIDv7
  title         TEXT NOT NULL,
  owner_uuid    UUID NOT NULL REFERENCES users(uuid),
  rnet_schema   TEXT NOT NULL,          -- protocol version this row was written under
  inferred      JSONB NOT NULL DEFAULT '{}'::jsonb,
  pull_config   JSONB,                  -- {enabled, sources[], policy, last_pulled_at}
  extensions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vibe_objects (
  vibe_uuid     UUID NOT NULL REFERENCES vibes(uuid) ON DELETE CASCADE,
  object_uuid   UUID NOT NULL REFERENCES objects(uuid),
  position      INTEGER NOT NULL CHECK (position >= 0), -- protocol-visible order
  added_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (vibe_uuid, object_uuid),
  UNIQUE (vibe_uuid, position)
);

-- Vibe reads always ORDER BY position. POST /vibes/{id}/objects allocates
-- consecutive positions in request order, appending by default in one transaction.

CREATE TABLE grants (
  vibe_uuid     UUID NOT NULL REFERENCES vibes(uuid) ON DELETE CASCADE,
  subject       TEXT NOT NULL,          -- 'id:…' | 'client:…' | 'public' | 'x-…:…'
  scopes        JSONB NOT NULL,         -- array of scope strings
  granted_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,            -- non-null = fails closed immediately
  PRIMARY KEY (vibe_uuid, subject)
);
-- No updated_at: scopes can be edited in place, and that change is
-- security-relevant, so it belongs in the audit trail. Grant edits write a
-- vibe_revisions row (which already snapshots grants), not a timestamp.

-- ══ History ══════════════════════════════════════════════════════════
CREATE TABLE object_revisions (
  object_uuid   UUID NOT NULL REFERENCES objects(uuid) ON DELETE CASCADE,
  block         TEXT NOT NULL CHECK (block IN ('source','user','inferred')),
  rev           INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,         -- the block as it was
  actor         TEXT NOT NULL,          -- 'id:…' | 'client:…' | 'system'
  operation_uuid UUID REFERENCES operations(uuid),
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (object_uuid, block, rev)
);

CREATE TABLE vibe_revisions (
  vibe_uuid     UUID NOT NULL REFERENCES vibes(uuid) ON DELETE CASCADE,
  rev           INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,         -- title, inferred, pull_config, grants
  membership_delta JSONB,               -- {added:[…], removed:[…]}
  actor         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (vibe_uuid, rev)
);

CREATE TABLE user_revisions (
  user_uuid     UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  block         TEXT NOT NULL CHECK (block IN ('inferred')),
                                        -- one value today; the column exists so
                                        -- name/avatar history can slot in later
                                        -- without a second table
  rev           INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,
  actor         TEXT NOT NULL,
  operation_uuid UUID REFERENCES operations(uuid),
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_uuid, block, rev)
);

-- ══ Operations & metering ════════════════════════════════════════════
-- One row per async job. Push, pull, and agent runs all return an id
-- immediately and execute in the background; this row carries status for
-- GET /operations/{id} polling, the request/result payloads, and the join
-- target for metering. One table with a `kind` discriminator rather than
-- three, because the lifecycle is identical across all three.
CREATE TABLE operations (
  uuid          UUID PRIMARY KEY,       -- UUIDv7
  kind          TEXT NOT NULL CHECK (kind IN ('push','pull','agent')),
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','aborted')),
  invoked_by    TEXT NOT NULL,          -- who caused this job, in the same namespaced
                                        -- grammar as grant subjects: 'client:rbudget',
                                        -- 'client:maker', 'id:{uuid}' for direct user
                                        -- action, or 'rhizome:{subsystem}' for
                                        -- store-initiated work with no machine involved
                                        -- ('rhizome:ingest', 'rhizome:scheduler').
                                        -- Always set — never null.
  vibe_uuid     UUID REFERENCES vibes(uuid),
  request       JSONB NOT NULL,
  result        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX operations_status_idx ON operations(status);
CREATE INDEX operations_invoked_by_idx ON operations(invoked_by);

-- Cost only. WHO CAUSED the work is operations.invoked_by; who PAYS is here,
-- and they differ routinely: a machine whose manifest says metering.payer =
-- "user" produces invoked_by 'client:rbudget' and payer 'id:{uuid}'. Keeping
-- them separate is what makes both "what does rBudget cost across all users"
-- and "what did this user spend, by machine" answerable.
CREATE TABLE meter (
  operation_uuid UUID PRIMARY KEY REFERENCES operations(uuid),
  payer         TEXT NOT NULL,          -- 'id:…' | 'client:…' | 'rhizome' (own account)
  model         TEXT,                   -- provider-qualified: 'openai/gpt-5'
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  turns         INTEGER,
  duration_ms   INTEGER,
  usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
  abort_reason  TEXT,                   -- ceiling hit: 'max_tokens'|'max_turns'|'max_wall'
  breakdown     JSONB
);

-- ══ Identity ═════════════════════════════════════════════════════════
CREATE TABLE users (
  uuid          UUID PRIMARY KEY,       -- UUIDv7; the rnet://id/{uuid}
  name          TEXT,                   -- display name, freely editable
  inferred      JSONB NOT NULL DEFAULT '{}'::jsonb,
                                        -- {writer}:{task} keyed, same shape as objects
                                        -- and vibes: memory, scoped to the person.
                                        -- Context assembly reads it so agent runs and
                                        -- push tasks start warm instead of cold.
                                        -- ONLY 'rhizome:*' KEYS. Object and Vibe memory
                                        -- is bounded — a client writing there speaks
                                        -- about a record it was granted. User memory
                                        -- has no such boundary: a client writing here
                                        -- would inscribe a claim about the PERSON,
                                        -- from a partial view, into the context every
                                        -- future run reads. The store decides what is
                                        -- worth remembering about a user; clients keep
                                        -- what they learn on the Vibe or object they
                                        -- learned it from. Enforced by the store.
                                        -- OWNER-ONLY: no scope exposes it, because it
                                        -- is derived across ALL of a user's Vibes and
                                        -- would otherwise leak inference from Vibes a
                                        -- client was never granted. Clearable by the
                                        -- user at any time and re-derived on demand —
                                        -- a cache, not a dossier.
  avatar_hash   TEXT,                   -- sha256 into the `assets` bucket. NOT an
                                        -- element: elements are protocol objects in
                                        -- the media graph, GC'd when no object
                                        -- references them. Product chrome stays out.
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE usernames (                -- handle→user; renames break no references
  handle        TEXT PRIMARY KEY,       -- casefolded at write
  user_uuid     UUID NOT NULL REFERENCES users(uuid),
  claimed_at    TIMESTAMPTZ NOT NULL,
  released_at   TIMESTAMPTZ             -- non-null = tombstoned, never reclaimable
);

-- Auth factors: how a user proves they are themselves.
CREATE TABLE credentials (
  user_uuid     UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('phone','passkey')),
  value_hash    TEXT NOT NULL,          -- hashed; never recoverable
  verified_at   TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (user_uuid, kind, value_hash)
);

-- Third-party source tokens: how the store reaches a user's data. Separate
-- from credentials because the lifecycle differs (rotation, revocation by the
-- provider, scope changes) and because these must be decryptable to be used,
-- while auth factors must never be.
CREATE TABLE source_credentials (
  uuid          UUID PRIMARY KEY,       -- UUIDv7
  user_uuid     UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  provider      TEXT NOT NULL,          -- 'simplefin' | …
  secret        BYTEA NOT NULL,         -- encrypted at rest
  metadata      JSONB,                  -- account ids, scopes, expiry
  connected_at  TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE sessions (                 -- Better Auth-managed
  token_hash    TEXT PRIMARY KEY,
  user_uuid     UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);

-- ══ Machines ═════════════════════════════════════════════════════════
CREATE TABLE machines (
  uuid          UUID PRIMARY KEY,       -- UUIDv7. This table implements the protocol's
                                        -- CLIENT concept: the uuid is the
                                        -- rnet://client/{uuid} an authored object's
                                        -- origin points at, and `name` is the
                                        -- client:{name} grant subject. "Machine" is our
                                        -- product word; "client" is the protocol's.
  name          TEXT NOT NULL UNIQUE,   -- the client:{name} grant subject
  owner_uuid    UUID REFERENCES users(uuid),      -- NULL for first-party
  trust         TEXT NOT NULL DEFAULT 'standard'
                CHECK (trust IN ('system','standard')),
                -- TEXT + CHECK rather than a PG enum: adding an enum value is easy,
                -- but removing or reordering means recreating the type and rewriting
                -- dependent columns.
  generated     BOOLEAN NOT NULL DEFAULT false,
  code_hash     TEXT NOT NULL,          -- sha256 of the built bundle, in R2
  manifest      JSONB NOT NULL,         -- declared requires/metering
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL    -- bundles are rebuilt and manifests change on
                                        -- redeploy; without this a stale row is
                                        -- indistinguishable from a fresh one
);
```

**Machines are uniform, first-party included.** A deploy-time seeder builds each directory under `machines/`, uploads the bundle to blob storage, and upserts a `machines` row with its code hash, manifest, and `trust` from a signed manifest. Generated machines take the identical path at creation time. Consequences: the sandbox loader resolves a bundle from its hash and never knows which kind it got, and **nothing in the runtime names a machine** — not Maker, not rBudget. rBudget seeds as `standard`, which is what makes it a real test of the standard tier rather than a privileged app wearing standard's label; Maker seeds as `system`.

### History and revert

History lives in the store's revision tables, never inside the object or Vibe JSON itself — a reader fetching current state should not drag the archive along with it. Every mediated write appends to `object_revisions` / `vibe_revisions` before applying. **Revert is not a special operation:** read an old snapshot, write it as the new current revision through the normal If-Match path — so it flows through existing mutation semantics and appears in history itself. All three blocks are versioned and retained: `user` history is the product (undo), `source` history is re-ingestion lineage, `inferred` history is the record of what models used to think. Only `user` writes take an `If-Match` — re-running a push task is a re-derivation, not a conflicting edit.

---

## 4. Store API

**Where it lives:** the API is *specified* in `rnet` (spec §4 defines routes, scopes, status codes; `@rnet/conformance` tests them) and *implemented* in `rhizome/apps/server`. The `rnet` repo contains zero server code — that separation is what lets a second implementer read the spec, run the suite, and never touch our source.

Base: `/rnet/v0`, bearer session auth, JSON bodies, RFC 9457 problem+json errors — `409 revision_conflict`, `403 grant_missing` (name the missing scope), `422 schema_violation` (with JSON Schema pointer), `422 ingest_nonconformant` (name the failing rule).

Full surface per spec §4: Vibes CRUD, `/objects`, `/elements`, `/origins`, two operations (`push`, `pull`), and `/operations/{id}` polling.

**Alpha scope (single-user).** Implement the full surface: Vibes / objects / elements / origins CRUD, push, pull, operations polling. Scope checking is real from M1 — every request validates the caller's scopes against the Vibe's grants, server-side — there just happens to be one user and one granted machine in the alpha, so the grants table has one row. The alpha targets the whole spec — there is no planned divergence. `CONFORMANCE.md` records *chosen* gaps (a stub, a deferral) and is expected to be empty at M1. Behaviour that diverges from the spec unintentionally is a bug: fix it, don't document it.

Semantics that must be real even in alpha:
- `PATCH /objects/{id}/user` requires `If-Match: {user_rev}`. `source` is never PATCHable.
- `pull` with `dry_run: true` returns candidates without committing. Dry-run review is **required**, not optional, for any ingestion that is not `reproducible: true`.
- Origins are owner-only: no scope exposes them, and machines reach ingestion only through host-rendered import flows.
- `owner` is required and store-assigned on origins, elements, objects, and Vibes. Machine-created records inherit the authorizing Vibe's owner. Reject cross-owner object/Vibe, object/element, and object/origin references. A machine may attach only objects it created for the target Vibe; an existing same-owner UUID is not sufficient authority.
- Objects are rejected at POST unless the `source` block passes **schema** validation — enforced from M1.
- **Ingest-record conformance** (spec §2.3: `parser_hash` required when `generated_parser`, `reproducible: false` forced when `agent`) is enforced from **M5**, when the record first has more than one reachable value. Until then it is a constant stamp — `{method: "parser", reproducible: true}` for ingested objects, `{method: "authored", reproducible: false}` for authored ones — and POST does not reject on it. Log this in `CONFORMANCE.md`.

---

## 5. Push tasks and ingestion

### 5.1 Push tasks

A push task is a **triple: a name, a prompt, and an output schema.** Tasks live in `apps/server/push/tasks/{name}/`:

```
push/tasks/categorize/
├── PROMPT.md       # the instruction, with the context assembly it expects
└── output.json     # JSON Schema for what one result looks like
```

The schema does three jobs: it constrains generation through `ModelConnector.complete({schema})`, it validates the model's response before anything is written, and it is what a future `GET /tasks` discovery endpoint would return so a client can learn a store's vocabulary rather than assume it.

**Why tasks carry their own schema rather than borrowing a protocol one.** `inferred.properties` is deliberately open — `{"type": "object"}` in `media-object.json` — because the whole point of the block is that a task may produce whatever its analysis produced. The protocol constrains the *envelope* (`{writer}:{task}` key, `model`, `inferred_at`, optional `confidence`) and says nothing about the contents. So the shape of `rhizome:categorize`'s output is a store concern, defined with the task, versioned with the task, and changed when the task changes. This is the concrete meaning of "task names are store-defined" in spec §4.3.

Results are written under the store's writer namespace (`rhizome:{task}`). A machine writing its own analysis via `write:inferred` supplies its own shape and writes under its own namespace — the store does not validate a machine's inferred properties beyond the envelope, because it has no schema for them.

### 5.2 Ingestion: skills, agent, sediment

Ingestion skills live in `rhizome/apps/ingest/skills/`, one directory per skill, in our own format — a thin adapter registers them with Pi, so they are not coupled to any harness.

**Skills live in two places, with different rules — the distinction is where a skill *executes*, not who wrote it.**

- **Ingestion skills** (`apps/ingest/skills/`) turn origins into objects. They touch raw bytes, run before validation, and their output becomes canonical `source` data — so only `system` machines may ship them, and third-party formats arrive through the promotion PR pipeline, never direct load. An untrusted ingestion skill is a prompt injection with a filename.
- **Machine-local skills** ship inside a machine's own bundle and load only for *that machine's* agent runs. They cannot exceed the machine's grants, cannot write `source`, and cannot reach a Vibe the machine wasn't given. Any machine may ship them, and the Maker writes them into the machines it generates.

```
skills/simplefin/                    # PRIMARY ingestion path
├── SKILL.md        # SimpleFIN response shape → transaction vocabulary; account
│                   #   handling; amount sign conventions; pagination
├── VERIFY.md       # REQUIRED. Executable invariants: object count == transaction
│                   #   count in the response; Σ amounts reconciles to the balance
│                   #   delta; required fields present; transaction id unique per account
├── BOUNDARIES.md   # REQUIRED. Permitted paths only — the user's own SimpleFIN
│                   #   access token, exchanged and stored server-side; sanctioned
│                   #   endpoints only; no credentialed scraping of anything else
└── scripts/
    └── fetch-simplefin.ts   # deterministic → method: "parser"

skills/ofx/                          # file-origin fallback (proves the upload path)
└── … same four files, parse-ofx.ts
```

**SimpleFIN is an API, not a file.** Three consequences:

**The origin artifact wraps the raw JSON response body.** Hash and store the payload the moment it arrives, then create its UUID OriginArtifact owned by the user whose source was fetched before parsing anything. Every resulting object inherits that owner. This is the design decision that matters, and the alternative — treating an API response as transient and re-fetching whenever you need to reprocess — is what to avoid: it would make API-sourced objects second-class, unreproducible, and dependent on a live connection and an unrevoked token months later.

Storing the body instead means **nothing downstream branches on how the bytes arrived**:

```
file:  user uploads chase.qfx  → POST /origins → origin UUID + content_hash ┐
                                                                            ├→ parser reads payload
api:   store fetches SimpleFIN → POST /origins → origin UUID + content_hash ┘   → objects, each with
                                                                                  source.origins = [origin UUID]
```

Only the first step differs. Same origins table, same endpoint, same conformance rule that every object references at least one origin, same VERIFY invariants, same re-ingestion path — resolve the origin UUID, load its payload by `content_hash`, parse again. A parser bug found six months from now is fixed the same way for both.

**The skill needs a credential**, so token exchange and encrypted server-side storage land at M2 rather than being deferred.

**Monthly pull actually works** — a re-fetch rather than asking the user to re-upload, which was hand-wavy when files were the only path.

Keep the upload path alive as the fallback: it is the only thing exercising user-supplied origins, and some banks will never be reachable any other way.

**Determinism ladder**, recorded in every object's `source.ingest`:
- `parser` — a committed script invoked directly, `reproducible: true`
- `agent` — an agent follows SKILL.md and extracts directly, writing no parser; never reproducible
- `generated_parser` — novel format: agent drafts a parser, `parser_hash` required, full VERIFY gauntlet, dry-run review forced. On approval the runtime **opens a pull request against `rhizome`** directly adding `skills/{name}/` — the generated parser, a drafted `SKILL.md` and `VERIFY.md`, and a fixture. Review, CI (the VERIFY gauntlet runs on the PR), and merge are the promotion mechanism: diffs render, discussion threads exist, and merge is a real audit trail.

**The fixture must never be the user's real data.** Sample origins are actual bank exports; the PR carries a synthetic or scrubbed fixture generated from the shape, never the file itself. This is a hard rule, because the default implementation is to attach what it has.


**Pipeline:** the server's `pull/` calls `@rhizome/harness` (packages/), which spawns a Pi subprocess per job with the origin bytes and the skill; the runtime parses, runs VERIFY invariants, and returns candidate MediaObjects as JSON; the server applies the dry-run gate, the pull policy, and schema validation, then commits. Ingestion MUST fully populate `source`, MUST NOT write `user` or `inferred`, and SHOULD populate `keys` with every global identifier the format exposes.

---

## 6. dMachines: sandbox, grants, and the Maker

A **dMachine** is any application that couples to a Vibe. Hand-written or generated, first-party or third-party, the baseline is identical — **shipping in this repo earns no privilege.** `machines/rbudget` runs under exactly the constraints a stranger's machine would.

### 6.1 Trust tiers

Two tiers, iOS-style, recorded on the `machines` row:

- **`standard`** — everything by default. Third-party machines, generated machines, and `machines/rbudget`.
- **`system`** — Rhizome-operated and signed, not user-installable. Today: `machines/maker`.

Two disciplines keep the tier from rotting into a dumping ground:

1. **Trust governs capabilities, not data.** System machines may ship skills and (later) use tool-enabled agent runs. They do **not** read Vibes without a user grant. Data access is user-granted at every tier, no exceptions.
2. **Every system-only capability is recorded with a reason and a hypothesis** for what would make it safely grantable to `standard` — otherwise the tier becomes where hard problems go to die.

System-only at launch: shipping skills (plan §5.2), tool-enabled agent runs (plan §7). The property that keeps this honest is that rBudget is `standard`: if the flagship machine is unprivileged, the standard tier is provably sufficient for real work.

### 6.2 Every machine, without exception

1. **Sandboxed.** Locked iframe, CSP with no network egress, postMessage bridge to `@rhizome/client` only. A machine never holds credentials and never talks to the store directly.
2. **Scoped by user-granted permission.** A machine declares required scopes in its manifest; the user grants them per-Vibe (`machine_grants`), and the **store** enforces them on every request. No grant, no data. A fully compromised machine reads exactly what was granted.
3. **Registered and code-hashed.** Every machine — generated or committed — has a `machines` row carrying its code hash, so whatever is running is always identifiable.
4. **Metered.** Machine-invoked pushes, pulls, and agent runs bill to the machine's payer identity under its budget.

Consequences worth stating: `machines/rbudget` must be developed against the sandbox from M4, not retrofitted at M6 — if the first-party machine needs an escape hatch, the SDK is wrong. And the sandbox is the *containment*, while grants are the *boundary*: sandboxing stops egress, grants decide what there is to exfiltrate.

### 6.3 The Maker (M6)

The Maker uses `@rhizome/harness` pointed the other direction: parsers on the write edge, machines on the read edge. Flow: intent → generation from a template (rBudget is template #1) → sandbox preview → grant request → registered machine.

One rule specific to generation, on top of plan §6.1:

**Generation context contains `@rnet/types`, `@rhizome/dmachine-sdk` docs, and the template — never Vibe data.** A transaction description is attacker-controlled text; it must have no path into codegen. Generated machines meet data only at runtime, inside the sandbox, through granted scopes.

---

## 7. The dMachine SDK (`@rhizome/dmachine-sdk`)

> **First draft.** This surface will change, in places significantly, as implementation proceeds. It describes the intended shape and the constraints that must hold, not a frozen API.

**Apache-2.0, published to npm, developed in `rhizome/packages/dmachine-sdk`. Implementation begins in M4 alongside rBudget, its first real consumer; before M4 this section is a design contract, not a package to maintain.**

**Two layers.** The **core** is framework-agnostic — plain TS functions plus an event emitter — so the data layer never assumes React. The **React layer** ships hooks, `<AgentSurface>`, and a **UI kit**: buttons, inputs, cards, tables, lists, empty and loading states, dialogs. The kit is not decoration. It gives every machine a shared visual identity instead of whatever the model felt like that day, and it gives the Maker a component vocabulary to compose in rather than raw divs — which is the single biggest lever on generated-machine quality.

The contract every machine is written against — first-party, third-party, and generated alike. It is also the Maker's generation target, so **its surface is the vocabulary the Maker can compose in**: keep it small, obvious, and hard to misuse. Everything the protocol punts to product (manifests, registration, metering, sandbox transport) lives here, never in `rnet`.

Transport: the SDK runs inside the sandboxed iframe and speaks postMessage to the host, which holds the session and calls the store. Machines never see a bearer token.

### Launch surface

```typescript
// ── 1. Declaration ────────────────────────────────────────────────
// Static manifest, read by the host before the machine ever runs.
export interface MachineManifest {
  name: string;                    // "rbudget"
  version: string;                 // semver
  requires: {
    rnet_schema: string;           // "^0.1"
    scopes: Scope[];               // ["read", "write:user", "push"]
    // Named slots. Each is independent — its own acceptable types and its own
    // cardinality — so a machine can want exactly one spending Vibe AND any
    // number of library Vibes:
    //
    //   vibes: {
    //     spending: { types: ["transaction"], min: 1, max: 1 },
    //     library:  { types: ["track"],       min: 1 }
    //   }
    //
    // The host renders a picker per slot; the machine reads them by name
    // (session.vibes.spending). `types` within a slot is a UNION — "a Vibe of
    // any of these types fills this slot" — not one of each. Wanting one of
    // each means two slots.
    vibes: Record<string, {
      types?: string[];            // acceptable types; omit = any
      min: number;                 // 0 = optional slot
      max?: number;                // omit = unbounded; the HOST caps it (1000),
                                   // because a manifest must not declare its own
                                   // resource limits
    }>;
    ingest?: { reproducible?: boolean };  // minimum provenance it will consume
    agent?: boolean;               // whether it calls agent.* at all
  };
  // Sample data shipped with the machine: a fixture Vibe per slot, dummy objects.
  // Powers "try it out" in the machine store, gives the Maker concrete shapes to
  // generate against, and lets a machine be exercised without granting real data.
  examples?: Record<string, VibeFixture>;
  metering: { payer: "developer" | "user"; budget_usd_per_user_month?: number };
  // trust is NOT self-declared — the host assigns it (plan §6.1). A manifest
  // claiming system tier is ignored; signing decides.
}
export function defineMachine(m: MachineManifest): Machine;

// ── 2. Session ────────────────────────────────────────────────────
// Handshake with the host. Resolves once the user's grants are known.
connect(): Promise<Session>
session.grants(): Grant[]                       // what we actually hold
session.requestGrant(scopes, vibeUris?): Promise<Grant[]>   // host-rendered consent UI;
                                                            // the OWNER grants — machines ask, never delegate
session.user(): { id: RnetId; handle: string }  // id is canonical and stable;
                                                // handle is display-only — never key off it.
                                                // The user's inferred block is NOT here and
                                                // has no scope: it spans all their Vibes, so
                                                // exposing it would leak inference from Vibes
                                                // the machine was never granted.

// ── 3. Data (read) ────────────────────────────────────────────────
vibes.list(): Promise<VibeSummary[]>            // only granted vibes
vibes.get(uri): Promise<Vibe>
vibes.objects(uri, { type?, since?, page? }): Promise<Page<MediaObject>>
objects.get(uri): Promise<MediaObject>
elements.url(uri): Promise<string>              // short-lived signed URL; never raw bytes

// ── 4. Data (write) ───────────────────────────────────────────────
// Each write needs its own scope; the store enforces, the client-side check
// only exists to make the error legible.
objects.setUser(uri, props, { ifMatch }): Promise<MediaObject>   // write:user
objects.create({ type, elements?, keys?, properties }): Promise<MediaObject>
                                                // write:objects — authored objects:
                                                // method "authored", origin is the
                                                // creating machine (server-supplied)
objects.setInferred(uri, task, entry): Promise<MediaObject>
                                                // write:inferred — pass the bare task
                                                // ("forecast"); the store prefixes it with
                                                // the machine's own name and rejects any
                                                // attempt to write another writer's key
objects.history(uri, { block? }): Promise<Revision[]>
objects.revert(uri, block, rev): Promise<MediaObject>   // replay, not time travel

// ── 5. Operations ─────────────────────────────────────────────────
ops.push(vibeUri, { task, selection?, target?, write_back? }): Promise<Operation>
ops.pull(vibeUri, { dry_run? }): Promise<Operation>    // needs `pull`; runs already-
                                                       // configured sources only
ops.watch(id): AsyncIterable<OperationEvent>    // progress + completion
ops.get(id): Promise<Operation>

// ── 6. Agent: transport + surface ─────────────────────────────────
// Machines get agentic capability without their own keys or runtime.
// The harness ALWAYS runs host-side; the machine holds a handle, never a runtime.
agent.session({ skills?, model?, system? }): Promise<AgentSession>
agent.stream(session, { prompt }): AsyncIterable<AgentEvent>   // raw transport
agent.models(): Promise<ModelDescriptor[]>      // provider-qualified

// The view half. Machines render arbitrary HTML in their iframe, so the SDK
// component is a POSITIONED PLACEHOLDER: the machine controls placement and
// styles around it; the host overlays its own iframe at the negotiated box and
// owns the pixels. Transcript, approval prompts, and cost display are
// host-rendered — a machine must not be able to spoof an approval or hide a cost.
<AgentSurface session={s} />                    // dock it, inline it, modal it
// <AgentSurface> is REQUIRED for any machine with a UI that uses agent.*:
// approval prompts and cost display are host-owned pixels and cannot be
// reimplemented. agent.stream() raw is for HEADLESS machines only — no UI,
// no user-facing agent interaction.

// Agent rules (v1):
//  • inference + skills only. No network, filesystem, or subprocess tools.
//    Tool-enabled runs are a `system`-tier capability (plan §6.1) — otherwise the
//    sandbox's no-egress guarantee dies the moment a machine asks its agent
//    to fetch a URL.
//  • scope inheritance: an agent run cannot reach a Vibe the machine wasn't
//    granted, AND agent-proposed writes to `user` blocks come back as a diff
//    the user confirms — same dry-run gate as ingestion. The model never
//    silently mutates user data.
//  • per-run ceilings enforced host-side: max tokens, max turns, max wall-clock.
//    Agent runs are unbounded in a way ops.push isn't.

// ── 7. Metering & UX affordances ──────────────────────────────────
usage.current(): Promise<{ usd, tokens_in, tokens_out, breakdown }>
usage.onCost(cb): Unsubscribe                   // fires on every billable op
ui.toast(msg, { detail? }): void                // host-rendered, sandbox-safe
ui.pickVibe({ types? }): Promise<VibeUri | null> // host-rendered picker
ui.importToVibe(uri): Promise<Operation | null>  // host-rendered "add data here":
                                                 // file picker or SimpleFIN connect,
                                                 // runs the pull, shows the dry-run
                                                 // diff, user confirms. Host-owned
                                                 // because the dry-run gate is a trust
                                                 // surface a machine must not spoof.
```

Notes for implementers:

- **`elements.url()` returns a signed URL, never bytes through the bridge** — keeps large media off the postMessage channel and blob auth in the host. Every element's bytes are reachable by protocol (spec §2.1), so there is no capability negotiation and no unrenderable-media path: platform-locked content is a reference in `keys`, and a machine that wants to hand off to a player reads the key.
- **Origins are absent from the SDK by design** and not delegable at all (doctrine 2). A machine can refresh an existing source with `ops.pull`; adding a *new* source, uploading a file, and reviewing a dry-run diff are host-rendered flows (`ui.importToVibe`), because the dry-run gate is a trust surface — a machine must not be able to spoof "totals reconcile ✓".
- **Three write scopes, three surfaces.** `write:user` annotates existing objects; `write:objects` creates authored ones (the notes/journal/tagger case); `write:inferred` persists a machine's own model output under a machine-namespaced task key. None of them can touch `source` after creation, `keys`, or `type`. Machines are apps, not only lenses — but every write is separately granted, so a read-only machine gets none of them.
- **Cost consent:** server-enforced hard cap from the manifest budget, `usage.onCost` firing on every billable op, and a host-rendered indicator the machine cannot suppress. A machine must not be able to burn a budget silently in a loop.
- The Maker generates against this surface only. If a generated machine reaches for something outside it, that's a signal about the SDK's design, not a prompt bug.

**What ships when:**

| Surface | Milestone |
|---|---|
| `defineMachine`, `connect`, `session.grants`, `session.user` | M4 |
| Read surface (`vibes.*`, `objects.get`, `elements.url`) | M4 |
| `objects.setUser`, `objects.create`, `objects.setInferred` | M4 |
| `ops.push`, `ops.watch`, `ops.get` | M3 |
| `ops.pull`, `ui.importToVibe` | M2 |
| `usage.current`, `usage.onCost`, `ui.toast`, `ui.pickVibe` | M4 |
| `objects.history`, `objects.revert` | M7 (store keeps revisions from M1; this is the UI) |
| `agent.*`, `<AgentSurface>` | M5 (harness); the Maker at M6 is the first consumer |
| `session.requestGrant` | M7 (single-user alpha grants at install) |

---

## 8. Milestones

**Success criteria, escalating:**
1. A stranger connects a bank through SimpleFIN (or drops a QFX file) and gets a working, personalized rBudget in under three minutes, with conformant provenance throughout.
2. A stranger with a weird credit-union CSV gets the same result via the generated-parser path.
3. **The next level:** a stranger describes an app and the Maker generates a working dMachine against their Vibe, sandboxed and scope-limited.

| # | Milestone | Contents | Exit test |
|---|---|---|---|
| M0 | Schemas compile | **First task: the codegen spike.** Run the 8 schemas through `json-schema-to-zod`; write ~10 assertions from the plan §9 fixtures — does the generated Zod reject `generated`-without-`parser_hash`? reject unnamespaced extra fields? accept `x-plaid`? If conditionals are mangled, take the ajv fallback (§3). Then: rnet repo, codegen pipeline, `@rnet/types`, conformance fixtures for both edges | `bun test` green on round-trips and negative cases |
| M1 | Store + shell stand | server: origins / elements / objects / vibes CRUD; Postgres; R2 via BlobStore; grant enforcement; auth (dev-bypass acceptable — real OTP at M7). **`apps/host` shell**: routing, layout, dock, vibe list, Zustand store, TanStack Query wiring, an empty sandbox container | conformance passes against both fs and R2 configs; the shell renders a Vibe created through the API |
| M2 | Compiled ingestion | **SimpleFIN** connect flow (token exchange, credential storage) + hardcoded response parser; CSV/QFX upload as the file-origin fallback; verify runner; dry-run flow | connected account → conformant transaction objects, invariants green; a re-pull picks up new transactions |
| M3 | Push pipeline | `ModelConnector` interface + OpenAI connector (`gpt-5.6-luna`, batch or flex); `push/tasks/categorize/` (prompt + output schema) and a Vibe-level `summarize` task; write-back under `rhizome:{task}`; metering rows | inferred blocks present, costs queryable, connector swappable, per-run cost visible in `meter` |
| M4 | rBudget | `machines/rbudget` on the SDK only, **inside the sandbox with granted scopes from day one**; upload → review → dashboard → user edits (If-Match) | the three-minute stranger test, with the machine holding no privilege a stranger's wouldn't |
| M5 | Agentic tail | `@rhizome/harness` live (ceilings + usage reporting); skill-guided path; generated-parser path; VERIFY gauntlet; draft promotion | a cursed credit-union CSV survives the gauntlet and opens a promotion PR; harness model chosen by measurement (`gpt-5.6-sol` vs `gpt-5.3-codex` vs a second provider) using the VERIFY gauntlet as the eval |
| M6 | The Maker | intent → generation from the rBudget template → sandbox preview → grant request → registered machine | success criterion 3: a stranger describes a machine and gets it, sandboxed |
| M7 | Polish for strangers | deploy; real phone auth; docs site; machine registry/provenance UI | a stranger completes criteria 1 and 3 |

**Ordering doctrine:** deterministic before generative, and generated *parsers* (M5) before generated *machines* (M6) — rBudget must exist as a hand-built template before the Maker can generate variations of it. *Variation before invention.* Nothing is thrown away: M2's hardcoded parser becomes M5's committed skill script; M4's rBudget becomes M6's template #1.

---

## 9. Test fixtures

Conformance fixtures assert the **invariants**, not every field of every type — type vocabularies are validated by their own schemas, so "a transaction without `currency` is rejected" is a schema test, not a fixture.

**Must accept:** an owned transaction object with `elements: []` (pure meaning-objects are normal) · an object with an `x-` namespaced extension · a Vibe with a writer-keyed inferred block · an owned authored object whose only origin is `rnet://client/{uuid}` · element, origin, object, and Vibe records carrying the same valid `rnet://id/{opaque}` owner · a paginated Vibe read that preserves `vibe_objects.position` order.

**Must reject:** an element, origin, object, or Vibe missing `owner` · a client-supplied owner conflicting with the authenticated owner · a cross-owner object/Vibe, object/element, or object/origin reference · a machine attaching a pre-existing same-owner object that it did not create for the target Vibe · an object with `source.origins: []` (grounding is uniform) · an inferred key with no `{writer}:` prefix · an inferred entry missing `model` · an ingest record claiming `generated_parser` without `parser_hash` · an ingest record claiming `agent` with `reproducible: true` · an unnamespaced additional property on a core object · a payload that fails its registered type vocabulary.

Element, origin, object, Vibe, user, and client record URIs use UUIDv7 in canonical hyphenated form · `content_hash` uses `sha256:[a-f0-9]{64}` and does not determine record identity · JSON Schema 2020-12. **Run validators with format assertion enabled** (`ajv-formats`), or date-times are just strings.

---

## 10. Alpha scope rules

Single-user alpha. Breaking DB changes are fine — nuke and re-migrate freely; the database is disposable.

The **spec does not get slimmer because the DB is disposable.** `rhizome/impl/CONFORMANCE.md` is a running list of *deliberate* gaps — things deferred on purpose — and becomes the M7 punch list. Unintentional divergence is a bug and gets fixed, not logged. The alpha targets the whole spec, so the file starts empty.

**Cut behaviors, not record-keeping.** Behaviors can be added later; records of the past cannot. Origins are stored from day one (the upload has to land somewhere regardless). The ingest record may be a constant stamp until M5 gives it a second possible value.
