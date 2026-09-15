# Vibe orb

**Status:** Speculative. Not decided, not scheduled, not approved for implementation. See
[AGENTS.md](./AGENTS.md). Deliberately parked until the push pipeline
([push-pipeline](../concepts/push-pipeline.md)) has landed its simpler tasks.

**Companion docs:** [push pipeline](../concepts/push-pipeline.md), [implementation
plan](../IMPLEMENTATION_PLAN.md), [design tiers](../concepts/design-tiers.md).

## 1. The idea

Every Vibe has an orb: a living sigil generated from the media it holds. It is the Vibe's face in
the dock, its list entry, and the hero of its surface. Like the Polyjuice potion taking the color
of the hair dropped into it, the orb is a visual reading of the Vibe's essence, and it drifts as
the Vibe fills.

Three properties define it:

- **Synthesized from both content and meaning.** Image-heavy Vibes contribute measured colors;
  text and record Vibes contribute colors and character chosen from their semantics. The two are
  blended, not chosen between.
- **Drift in proportion to change.** The first ten objects reshape the orb; the hundred-and-first
  barely moves it.
- **More than color.** Texture, motion, and tactility are part of the recipe. The orb is animated
  at rest and responds to hover and click. The concept renders (speckled and noisy, soft pink
  glow, hard-edged red and black, glassy yellow) are four points in a continuous space, not four
  templates; nothing limits the forms to a fixed set.

## 2. Shape of the solution

The store computes a **recipe**, a small set of continuous parameters stored as an inferred entry
on the Vibe. The host renders it with one shader. The pipeline never produces pixels; the host
never decides essence.

```text
objects ──► rhizome:palette (per object)  ──┐
                                             ├──► rhizome:orb (per Vibe) ──► host shader ──► pixels
Vibe summary + type/element histogram ───────┘         │
                                             previous recipe ──┘  (proportional drift)
```

### 2.1 `palette` (object level)

One to three colors with weights per object. Rules-first: an object with image elements gets
measured dominant colors from its pixels, no model call; objects without images get colors the
model chooses from their semantics. Cheap, deterministic where it can be, and fresh forever unless
the object changes. This is the backbone that makes drift proportional: an aggregate over a
hundred contributions moves about one percent when one more arrives.

### 2.2 `orb` (Vibe level)

A model call over the Vibe summary, the type and element histogram, and the aggregated member
palette returns a full recipe. The store then blends toward it from the Vibe's current
`rhizome:orb` entry:

```text
next = lerp(previous, fresh, changed_objects / total_objects)
```

The blend happens in code, not in the prompt, so the task remains an independent re-derivation.
Blob layout is seeded from the Vibe UUID so the shapes are the Vibe's identity and only the
character drifts. Freshness follows the push pipeline's rule: membership or member changes
invalidate the entry.

### 2.3 The recipe

All scalars 0..1 unless noted. The model places each Vibe somewhere in this space.

| Group    | Parameters                                                 | What they do                                                                                                       |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Palette  | 2–6 colors with weights; `contrast`                        | Which colors, how much of each, how sharply regions meet (soft gradient vs hard edge)                              |
| Field    | `grain`, `roughness`, `warp`, `cellularity`, `anisotropy`  | Noise frequency (speckled vs blobby), octaves, domain warping (swirls), cell-like vs smooth, streaked vs isotropic |
| Surface  | `gloss`, `glow`, `rim`, `grainOverlay`                     | Specular size, subsurface light from the center, rim light, film grain                                             |
| Motion   | `drift`, `turbulence`, `pulse` (amplitude, period), `spin` | Blob wander, animated secondary warp, breathing, rotation                                                          |
| Response | `viscosity`, `reactivity`, `splash`, `settle`              | How slowly and how much it follows the cursor, click energy, time to calm                                          |

The recipe carries a `version` so the host can refuse or upgrade recipes from an older renderer.

## 3. Rendering

One fragment shader draws any orb; the recipe is its uniform block. No scene graph.

- **WebGL2** is the browser's GPU API: hand programs to the graphics card and draw onto a
  `<canvas>`.
- **GLSL** is the shader language. A fragment shader runs once per pixel and returns its color;
  the orb is one such function of pixel position, time, and the recipe.
- **OGL** (~30 KB) wraps the boilerplate (compiling shaders, the quad, uniforms, resize). It is
  preferred over three.js (~600 KB of scene system the orb never uses); raw WebGL2 is acceptable.
  three.js earns its place only if the orb later becomes a lit object in a real scene, and the
  recipe transfers unchanged.

Per pixel: sphere mask and a fake normal from the disc; fractal noise on the sphere driven by the
field parameters; palette lookup with `contrast` as the smoothstep width; lambert, specular, rim,
glow, grain; time enters the noise as a third dimension scaled by `drift`, plus `turbulence`,
`pulse`, `spin`. Cursor position and an energy value are uniforms: a spring in TypeScript chases
the cursor with `viscosity` as damping, `reactivity` bends the field toward it, a click injects
`splash` energy decaying over `settle`. Hover and click are parameterized behaviors, never per-Vibe
code. About 150 lines of GLSL and 200 of TypeScript.

Practicalities:

- One compiled program, per-orb uniforms. The hero and dock run live; lists render each orb once
  to a small offscreen canvas and show the bitmap, re-rendering only when the recipe changes.
  That offscreen render is also the raster (PNG) needed wherever a shader cannot run: favicon,
  notifications, link previews. Not designed yet.
- Recipe changes tween over a second or two in the host: this is the "taking shape" animation,
  for any change.
- `prefers-reduced-motion` freezes time. No WebGL falls back to a CSS radial gradient built from
  the palette, so the orb is never missing, only still.
- `VibeOrb.tsx` and the static orb assets are deleted when this lands; nothing about the current
  image-based orb carries over.

## 4. Import-time crystallization

The concept shows the orb forming during a Vibe's first import. The recipe can only be computed
once objects exist in the Vibe, and computing it while media is still being fetched and parsed
adds latency to the critical path. This needs its own plan and depends on unattended first import
(a reproducible source committing without owner review), which is not yet scheduled in the
implementation plan. Until then, the orb forms when the first `orb` push completes after import.

## 5. Open questions

- Where the orb appears (dock, list, hero at minimum) and at what sizes.
- Whether idle motion is on by default or only on hover.
- Whether the `palette` task's image color measurement runs in the pipeline's rules step (bytes
  in a deterministic function) or as a store-side analysis pass separate from push.
- Whether a Vibe's owner can pin an orb (currently: no).
- The blend function beyond linear interpolation, and the per-parameter blend rates (colors may
  drift slower than motion).

## 6. Sequence, when it is taken up

1. A standalone prototype page: the shader with a slider per scalar, tuned against the concept
   renders until the space feels right. No pipeline involvement.
2. `palette` and `orb` tasks in the push registry, with a fake-connector recipe in tests.
3. Host renderer replacing `VibeOrb.tsx`, live in dock and hero, bitmaps in lists.
4. Raster export and import-time crystallization as separate plans.
