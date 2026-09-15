# Vibe orb

**Status:** implemented in the push pipeline and host UI; the standalone playground remains the
tuning surface.

Companion documents: [push pipeline](./push-pipeline.md), [design tiers](./design-tiers.md),
[implementation plan](../IMPLEMENTATION_PLAN.md) §8.2, rNet spec §2.3 and §6.2.

## 1. Product contract

Every Vibe has a host-rendered orb: a procedural identity mark derived from both its content and
meaning. The store derives a compact recipe and persists it as store-authored Vibe inference; the
host renders that recipe. The store does not generate pixels, and the host does not infer the
Vibe's semantics.

The first version has these settled boundaries:

- A new inferred result replaces the previous non-durable recipe as an independent re-derivation.
  There is no proportional-drift blend, changed-object count, or freshness mechanism. The host may
  tween between two complete recipes for visual continuity.
- There is no owner pinning or “keep this orb” control.
- Dock and Vibe-hero orbs animate gently at rest. List and card orbs are still until their
  accessible parent is hovered or receives keyboard focus, then return to rest.
- Reduced-motion mode freezes shader time and response. WebGL loss or absence falls back to a
  palette-derived CSS still, so the identity mark remains usable.
- A local still bitmap for inactive list/card presentation belongs to the renderer. External
  favicon, notification, and link-preview exports are deferred.
- Measured image colors and semantically selected colors both contribute to the eventual recipe.
  Formation during pre-confirmation ingestion is deferred.

## 2. Renderer playground

`/playgrounds/vibe-orb` is the isolated tuning surface. It uses one raw-WebGL2 fragment shader with
four deliberately distant presets, a control for every draft scalar, a deterministic string seed,
live recipe transitions, and previews at 20, 44, 48, 72, and hero scale. The presets are points in
one continuous space rather than artwork templates.

The renderer input is `OrbVisualRecipe`; version 1 is also the persisted properties schema for
`rhizome:vibe-orb`. Its groups are palette/contrast, field, surface, motion, and response. Each
canvas owns its WebGL context and compiled program; no cross-context program sharing is assumed.
Animation frames are visibility-aware, stop for reduced motion and still mode, and
interaction-only instances sleep outside hover/focus response and settling.
Desktop Vibe cards use a solid tint derived from the dominant inferred palette color; cards
without a recipe derive the same solid treatment from their deterministic fallback recipe.

## 3. Store integration

`vibe-orb` is an installed Vibe-level push task, runs after `summarize` and `vibe-view` during
automatic import enrichment, and can be invoked independently through the ordinary push endpoint.
It receives the summary, type/element histograms, a stable opaque seed derived from Vibe identity,
and an aggregated member-image palette.

The task's bounded context hook considers the first twelve distinct supported image elements in
member order, ignores payloads over 12 MiB, decodes no more than 16,777,216 input pixels, samples a
32px thumbnail, and selects up to four diverse weighted colors per aggregate. Invalid images are
omitted without preventing semantic derivation. The model selects the semantic colors and all
continuous controls. A task-owned transform forces the stable seed and blends measured colors into
the final palette before the usual output validation and inferred writer. This keeps cancellation,
durable preservation, independent re-derivation, Vibe revisions, status, producer attribution, and
metering in the existing push lifecycle.

The host strictly decodes version 1; missing or malformed entries receive a neutral gray
pre-inference recipe modeled on the shared Vibes page icon, with the Vibe URI retained only as its
procedural seed. Dock and hero instances use continuous motion. Desktop cards and Vibe list rows
explicitly pass parent hover and keyboard-focus state into interaction-only instances. Task
revision changes invalidate both the Vibe document and the Vibe catalog so every placement receives
the new complete recipe.

## 4. Deferred

Local bitmap caching for sleeping list/card instances, external favicon/notification/link-preview
exports, and pre-confirmation formation remain deferred. Proportional drift and owner pinning are
explicitly out of scope.
