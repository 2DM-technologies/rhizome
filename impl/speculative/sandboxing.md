# dMachine Sandboxing

**Status: speculative. Not decided, scheduled, or approved for implementation. See [AGENTS.md](./AGENTS.md). The proposals below retain their original wording for discussion; they are not implementation requirements.**

Companion documents: [implementation plan](../IMPLEMENTATION_PLAN.md) (§6.2, §7), [rNet specification](../../../rnet/spec/rnet-spec-v0.1.md) §3. The implementation plan and rNet specification remain authoritative.

---

## 1. What the sandbox is for

Recap, because every decision below follows from it.

- **Grants are the authorization boundary, enforced server-side.** A dMachine reads exactly what it was granted, no matter what it does client-side.
- **The sandbox is containment.** It stops a dMachine from exfiltrating what it _was_ legitimately given, from reaching the host's DOM or session, and from making network calls of its own.
- **dMachines never hold credentials.** The session lives in the host. A dMachine asks over the bridge; the host calls the store.

Consequence: the security property of the whole system is **everything the host will do on a dMachine's behalf.** The iframe is plumbing. The bridge is the design.

---

## 2. Decision: arbitrary code, sandboxed iframe, for the alpha

dMachines run arbitrary logic and render arbitrary DOM inside a sandboxed iframe. This is the alpha mechanism. It is **not** the final answer — see §6.

**Why the other options lose, so nobody re-derives them:**

| Approach                          | Why not                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QuickJS-in-WASM (Figma)           | Figma needed it for _synchronous_ main-thread access to the scene graph. Our data access is async over a bridge by construction; an iframe already gives a separate realm (and, cross-site, a separate process). QuickJS buys nothing here.    |
| Worker + virtual DOM (remote-dom) | Only isolates if the host renders a vetted component set. Arbitrary DOM emitted from a worker and rendered by the host is XSS in the host. This is the _palette_ design, evaluated in §6 — not an isolation mechanism for arbitrary rendering. |
| SES / Hardened JS                 | In-process, not a hard boundary. Salesforce migrated away from it.                                                                                                                                                                             |
| ShadowRealm                       | Stage 2.7, unshipped, and DOM-less anyway.                                                                                                                                                                                                     |

Given the requirements _arbitrary logic_ and _direct rendering_, the iframe is the only option. The remaining question was where it is served from, which §3 settles.

---

## 3. Iframe configuration

### 3.1 Origin model — **same-origin vs. cross-origin is not the question it looks like**

An iframe with `sandbox="allow-scripts"` and _without_ `allow-same-origin` has an opaque origin regardless of what host serves it. Same-origin vs. cross-origin is therefore not a DOM/storage isolation question — the sandbox attribute already gives that for free.

What a separate domain actually buys:

1. **Process isolation against Spectre-class reads.** One renderer process means a malicious dMachine can, with effort, read host memory — and the host holds the session token. Chrome's Site Isolation separates by _site_ (eTLD+1), not origin.
2. **A verifiable, non-opaque origin.** With an opaque origin, `event.origin` is the string `"null"` and the host cannot tell dMachines apart by origin. With a real cross-site origin and `allow-same-origin` _kept_ (safe, because the origin is a throwaway domain sharing nothing with the host), the host verifies exactly which dMachine sent every message.

**Decision:** dMachines are served from a **separate registrable domain** (not a subdomain of the host domain), one subdomain per dMachine, **labeled by code hash**:

```
https://{hash}.rhizome-dmachines.net/
```

where `{hash}` is the first 32 hex chars of the bundle's sha256 (DNS labels cap at 63; 32 hex is ample). The origin _is_ the code identity: two versions of a dMachine never share storage, and the host verifies it is talking to the bundle it loaded. This is the runtime expression of "registered and code-hashed" (plan §6.2).

**Site Isolation caveat — important.** Subdomains of one registrable domain are _same-site_, so Chrome puts them in one process. dMachines would be isolated from the host but **not from each other**. `Origin-Agent-Cluster` does not fix this; Chrome documents it as a performance hint, not a security boundary. The fix is to list `rhizome-dmachines.net` on the **Public Suffix List**, the way `github.io` is, so each subdomain is its own site.

- PSL submission takes weeks. **Submit it now**, during the alpha, even though the alpha does not need it. This is the one piece of sandbox infra whose cost is on the critical path.
- Until the PSL listing lands, send `Origin-Agent-Cluster: ?1` on every bundle response as a best-effort hint. Do not treat it as isolation.

The dMachine host remains a **config value** (`DMACHINE_HOST`), per the existing hedge. Local dev uses a `*.dmachines.localhost` style wildcard.

### 3.2 Iframe attributes

```html
<iframe
  src="https://{hash}.rhizome-dmachines.net/"
  sandbox="allow-scripts allow-same-origin"
  allow=""
  referrerpolicy="no-referrer"
></iframe>
```

- **No** `allow-popups`, `allow-top-navigation`, `allow-forms`, `allow-modals`, `allow-downloads`. Add nothing to `sandbox` without a written reason in this file.
- `allow=""` denies every Permissions-Policy feature: camera, microphone, geolocation, clipboard-write, payment, etc. A dMachine that needs one asks the host over the bridge; the host decides.
- The host never passes the session, a token, or a store URL into the iframe by any mechanism — not `src` query, not `name`, not `postMessage`.

### 3.3 Response headers on the bundle server

Every response from `*.rhizome-dmachines.net` carries:

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src https://elements.rhizome-cdn.net;
  media-src https://elements.rhizome-cdn.net;
  font-src 'self';
  connect-src 'none';
  frame-src 'none';
  worker-src 'self';
  form-action 'none';
  base-uri 'none';
  frame-ancestors https://{HOST_ORIGIN};
X-DNS-Prefetch-Control: off
Origin-Agent-Cluster: ?1
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-origin
```

Notes:

- `frame-ancestors` pins dMachines to the Rhizome host. A dMachine bundle loaded anywhere else renders nothing.
- `img-src` / `media-src` allow the signed-URL host only. **Known, accepted residual channel:** a dMachine can encode data into query strings of requests to _our_ blob host. The listener is us, so this is a log-hygiene concern, not exfil. Do not widen it.
- `connect-src 'none'` does **not** govern WebRTC. CSP3 defines `webrtc 'block'`; include it and verify support at M7. `allow=""` on the iframe is the belt to that suspender.
- `X-DNS-Prefetch-Control: off` closes `<link rel=dns-prefetch>` leaking bits through DNS to an attacker-named host, which CSP does not reliably catch.
- CSP is **header-delivered**, never `<meta>`. A cross-site bundle server makes this trivial; it is one of the reasons not to use `srcdoc`.

### 3.4 Host-side

- The host sets `Cross-Origin-Opener-Policy: same-origin` and a CSP that lists `https://*.rhizome-dmachines.net` in `frame-src` and nothing else dMachine-related.
- Host-rendered overlays (approval prompts, cost display, dry-run review, import flow, `<AgentSurface>`) are host DOM positioned over the iframe's box. Z-order means a dMachine cannot paint over them. A dMachine _can_ paint a convincing fake inside its own box — see §5.

---

## 4. The bridge

This is where the security effort goes. Rules:

1. **Every message is schema-validated on the host.** Zod schemas in `@rhizome/dmachine-sdk` define the wire format for both directions. An unrecognized message type or a malformed payload is dropped and logged with the dMachine hash. Never "best-effort parse."
2. **The host checks `event.origin` against the expected `https://{hash}.rhizome-dmachines.net` for that iframe, and `event.source` against the iframe's `contentWindow`, on every message.** Both, always. A mismatch drops the message.
3. **`postMessage` from host to dMachine always passes the exact target origin, never `"*"`.**
4. **There is no passthrough.** No message type means "call this store endpoint with these args." Each bridge operation maps to exactly one SDK surface call (plan §7), and the host builds the store request itself from the dMachine's _known grants_ plus the validated payload. A dMachine cannot name a Vibe it was not granted and have the host try.
5. **Capability table per iframe.** On connect, the host resolves the dMachine's grants and builds an in-memory table of what that iframe may ask for. Bridge handlers consult the table before the store is ever called. The store still enforces (doctrine 2); this table exists so the _error is legible_ and so a compromised dMachine generates 403s in our logs rather than probes against the store.
6. **`elements.url()` returns a signed URL, never bytes** — preserved. Large media never crosses the bridge.
7. **External links are host-mediated.** A dMachine cannot navigate the user anywhere (sandbox forbids it). `ui.openExternal(url)` is a bridge call; the host shows the destination and the user confirms. This is the only path off-site, and it is a user action with the URL visible.
8. **Request IDs and timeouts.** Every request carries an id; the host replies with the id; unanswered requests time out in the SDK. No fire-and-forget from dMachine to host except `ui.toast`.

The bridge lives in the SDK's event emitter (plan §3, Frontend) and feeds the Zustand shell store. Connection status, pending queues, and the capability table are per-iframe and die with it.

---

## 5. Host-owned pixels

Per plan §7: approval prompts, cost display, dry-run review, import flow, and the agent surface render in the host. A dMachine positions; the host draws.

What the sandbox does **not** solve: a dMachine painting a look-alike consent dialog inside its own box. The sandbox guarantees the real one is host-drawn; it does not guarantee the user can tell the difference.

**This is a design-system requirement, logged here so it is not lost:** host-tier chrome must have a visual grammar the SDK UI kit does not expose. Dialectical UI's polarity inversion is the instrument — the host tier is the one level a dMachine cannot render in, because the kit never gives it those tokens. Track as a design-system task; it is not blocking for the alpha (friends-only, no adversary) but is blocking for Agora.

---

## 6. The palette question — deferred to evidence, instrumented now

The alternative to arbitrary rendering is a **fixed palette**: dMachine logic still runs as arbitrary code, but it emits a tree of SDK components that the _host_ renders (a custom React reconciler; remote-dom is the reference implementation). This would:

- make host-owned pixels structural rather than conventional (the palette has no consent-looking primitive; the host decides polarity),
- collapse the egress surface to bridge messages and UI trees, both schema-validated — most of §3.3 evaporates,
- drop per-dMachine memory from 30–50MB (process) to a few MB (worker),
- give the Maker a serializable, _validatable_ generation target.

Its cost is expressiveness: canvas-class dMachines (visualizers, cropping, frame-rate interaction) do not fit. Whether that matters depends on what dMachines actually get built, which is the evidence the alpha exists to produce.

**Decision:** do not design the palette from guesses. Run the alpha on arbitrary code and measure what dMachines reach for. Then decide between (a) palette-by-default with a declared `raw_surface` capability backed by the §3 iframe, or (b) §3 as the permanent default.

### 6.1 Instrumentation — required from M4

For the measurement to mean anything, the UI kit must be the **path of least resistance**, so that reaching outside it is a signal rather than a default.

1. **`dmachines/rbudget` uses the SDK UI kit exclusively.** Zero raw elements, zero canvas, zero non-kit imports. This is non-negotiable: rBudget is the Maker's template, so any escape in rBudget propagates into every generated dMachine and contaminates the signal from the start.
2. **The Maker template and system prompt compose from the kit only.** Generated dMachines that reach outside it are the signal; do not suppress it in the prompt, just don't encourage it.
3. **The dMachine bundler emits a `kit-escapes.json` per build** and the seeder stores it on the `dmachines` row (`manifest.kit_escapes` or a sibling JSONB column — implementer's choice, but it must be queryable). Record:
   - raw HTML elements used outside the kit, by tag, with counts,
   - `<canvas>` / WebGL / `<svg>` usage,
   - non-kit, non-vetted imports,
   - CSS-in-JS or inline style usage beyond the kit's style props,
   - `ui.openExternal` call sites.
     Implementation: a Vite plugin walking the JSX AST at build time is sufficient. It reports; it does not block.
4. **One query answers the question.** At the end of the alpha: "of N dMachines, how many stayed in-kit; for the rest, what did they need?" That table is the palette spec and the `raw_surface` justification in one artifact.

### 6.2 What stays regardless

The §3 iframe infra is correct under either outcome — as the default, or as the `raw_surface` tier. Nothing built for it is wasted. The PSL submission in particular should not wait on this decision.

---

## 7. Alpha scope

Single user plus a few friends; no adversary. Everything in §3 and §4 is implemented from M4 because rBudget must be developed _against_ the sandbox, not retrofitted (plan §6.2). What is allowed to be incomplete in the alpha:

- PSL listing may still be pending (submit anyway).
- `webrtc 'block'` support unverified.
- Host-chrome visual grammar (§5) may be conventional rather than enforced.

Log each of these in `CONFORMANCE.md`-style fashion in this file's status header so they become the Agora punch list rather than forgotten defaults.

---

## Appendix: Threat model summary

| Threat                                               | Mitigation                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dMachine reads host session/DOM                      | Cross-site origin; sandbox attribute; no token ever crosses the bridge                                                                                                                                     |
| dMachine reads host memory (Spectre)                 | Site Isolation via separate registrable domain; PSL listing for inter-dMachine isolation                                                                                                                   |
| dMachine exfiltrates granted data                    | `connect-src 'none'`, no navigation, no forms, no popups, DNS prefetch off, Permissions-Policy empty; only egress is signed-URL host (ours) and host-mediated external links (user-confirmed, URL visible) |
| dMachine impersonates another dMachine on the bridge | Hash-labeled origin checked per message; `event.source` checked per message                                                                                                                                |
| dMachine asks the host for data beyond its grants    | Capability table on the host; no passthrough bridge ops; store enforces regardless                                                                                                                         |
| dMachine spoofs a consent surface                    | Host-rendered overlays (z-order) + host-tier visual grammar (§5, design-system task)                                                                                                                       |
| dMachine burns budget silently                       | Server-enforced cap; `usage.onCost`; host-rendered cost indicator it cannot suppress (plan §7)                                                                                                             |
| Compromised npm dependency in a first-party dMachine | Same containment as a stranger's dMachine; vetted library set in the kit; first-party earns no privilege (plan §6)                                                                                         |
