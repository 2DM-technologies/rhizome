# `ui_component` elements in MediaObjects

**Status:** Speculative. Not decided, not scheduled, not approved for implementation. See
[AGENTS.md](./AGENTS.md).

**Companion docs:** [M2 implementation plan](../IMPLEMENTATION_PLAN.md),
[conformance status](../CONFORMANCE.md), [sandboxing](../concepts/sandboxing.md), and
[design tiers](../concepts/design-tiers.md).

## 1. The primitive

A **sixth MediaElement kind: `ui_component`.** Its payload is a serialized tree of components drawn
from a closed, **rNet-defined** vocabulary.

A MediaObject may carry **any number** of them, alongside its text/image/video elements. A
`ui_component` is a first-class piece of content — _not_ necessarily a presentation of its parent
object. It may bind to that object's data, or be entirely static.

```text
MediaObject
├─ source.properties
└─ elements[]
   ├─ text          content
   ├─ image         content
   ├─ ui_component  a component (may bind to this object, or not)
   └─ ui_component  another one
```

## 2. Why this earns a kind

**The consumption strategies are genuinely distinct.** The schema calls `kind` the "consumption
strategy," and each existing one is real:

| kind                  | how a human gets to it                              |
| --------------------- | --------------------------------------------------- |
| text                  | decode, display                                     |
| image / audio / video | decode with a codec, present                        |
| document              | hand to a viewer, or download                       |
| **ui_component**      | **interpret a tree against a vocabulary, mount it** |

That last row isn't a variant of "display these bytes" — it's the only one where the payload
describes a rendering rather than being one.

**The protocol's own test passes.** _"A kind exists iff a human consumes that thing directly."_ A
person looks at a button and presses it; the component **is** the consumed thing. That's what
separates it from a font (`document` + `font/woff2`) or a stylesheet (`document` + `text/css`) —
instruments for consuming something else, which is why those correctly stay documents.

It meets MediaElement's hard requirements — real bytes, real `content_hash`, real mime. Since `0.1`
is an unfinished draft, adding the kind needs no version bump, but it touches spec, generated types,
validators, and fixtures together.

## 3. The payload

```json
{
  "vocabulary": "rnet.ui@0.1",
  "root": {
    "type": "Box",
    "props": { "gap": 2 },
    "children": [
      { "type": "Text", "props": { "bind": "source.properties.author" } },
      {
        "each": "elements",
        "as": "el",
        "child": { "type": "Image", "props": { "bind": "el" } }
      },
      { "type": "Marquee", "fallback": "drop" }
    ]
  }
}
```

Three things carry weight:

- **The parent object is ambient, not required.** A component that binds, binds; a static one
  contains no bindings. One contract covers both.
- **`vocabulary` states which version the tree was authored against**, so a client can render,
  degrade, or refuse rather than silently dropping unrecognized nodes.
- **`fallback` declares degradation per node** — `"drop"`, or an alternate subtree. This is what
  makes vocabulary growth survivable: a component authored against a later vocabulary still renders
  acceptably in an older client.

## 4. Prior art

The `{type, props, children}` shape is universal — React, hast, and Adaptive Cards all land there,
so nothing is being invented.

[Adaptive Cards](https://learn.microsoft.com/en-us/adaptive-cards/templating/language) is the
closest precedent: published JSON schema, closed element vocabulary, native renderers per platform.
Its template language independently arrived at the same three constructs — `${...}` binding, `$data`
over arrays, `$when` for conditionals — reasonable evidence this is the right level of
expressiveness.

**Not adopted wholesale**, because the vocabulary being rNet-defined is the entire point; taking
Adaptive Cards means taking Microsoft's vocabulary, and hast means taking HTML's. What's borrowed is
`fallback` and version negotiation — both cheap now, expensive to retrofit.

## 5. JSX authors, the tree stores

JSX is the better authoring format and the worse storage format. A tree is inert data validated by a
schema check. JSX is a program — once it executes, the closed vocabulary stops being enforceable
(computed member access, dynamic import, hooks, I/O). Full JSX also needs a JS runtime per
component: dMachine-weight, 30–50MB/process per [sandboxing](../concepts/sandboxing.md) §6,
impossible in a feed.

```text
JSX ──compile──▶ tree ──store──▶ ui_component element ──render──▶ client components
```

The ESTree JSX AST is a real standard but the wrong layer — it's source syntax, and it can carry
arbitrary expressions.

## 6. Rendering

The tree _is_ React's shape — `React.createElement(type, props, children)` and
`{type, props, children}` are the same structure. A client binds the rNet vocabulary to its own
components and walks the tree:

```jsx
const KIT = { Box, Button, Text, Image, Card, Badge }; // Rhizome's binding

function render(node, object, key) {
  if (node.bind) return resolve(node.bind, object);
  const C = KIT[node.type];
  if (!C) return renderFallback(node, object, key); // drop, or alternate
  return (
    <C key={key} {...node.props}>
      {node.children?.map((c, i) => render(c, object, i))}
    </C>
  );
}
```

The vocabulary is enforced by a missing map key — not a lint rule, not static analysis. `KIT` is
Rhizome's binding; another client could bind the same names to SwiftUI, to static HTML, or to a text
flattening for a model context, and the stored tree wouldn't change.

## 7. Expression grammar

Non-Turing-complete; three declarative constructs, and the compile target for JSX expressions:

| construct | form                                 |
| --------- | ------------------------------------ |
| `bind`    | `{bind: "source.properties.author"}` |
| `each`    | `{each: "elements", as: "el", …}`    |
| `when`    | `{when: "elements.length > 0", …}`   |

## 8. The consequence

**UI becomes portable media.** A component is content — owned, immutable, content-addressed,
provenance-carrying, shareable, curatable — and because the vocabulary is protocol-level, it renders
in any rNet client. You can pin a button, fork someone's dialog, collect components into a vibe. A
design system becomes a collection instead of a codebase.

## 9. Open questions

- **Addressing multiple components.** `MediaObjectElementRef` is `{uri, role?, alt?}` with `role`
  closed to `title | content | preview`. That can't distinguish several `ui_component`s on one
  object — you'd need a `name`/`slot` on the association, or a widened role vocabulary. First
  concrete schema consequence of "many per object."
- **Interaction has no home.** Components are presentation-only by construction; what a button
  _does_ isn't expressible in an inert tree. That's the boundary where this meets dMachines.
- **`source` is immutable after ingest**, so a `ui_component` on an imported object is frozen at
  import time.
- **Order and roles** between `ui_component` and content elements in one `elements` array.
- **Where the vocabulary schema lives.** A namespace of its own, separate from `schemas/0.1/types/`:
  one schema for the tree format (nodes, `bind`/`each`/`when`, `vocabulary`, `fallback`) plus
  per-primitive prop schemas. It reuses the mechanical registration pattern the object types use —
  schema file, codegen entry, compiled validator keyed by `node.type` — but it is a distinct
  vocabulary and must not share a namespace or registry with MediaObject types. Object types are an
  open vocabulary where unregistered values remain legal; the UI vocabulary is closed, so an
  unregistered primitive is invalid rather than merely unvalidated.
