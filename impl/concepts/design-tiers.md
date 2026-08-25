# Design tiers

**Status: implemented in `apps/host/src/styles/tokens.css` and the Storybook UI kit. Resolves the
"host-tier visual grammar" task logged in `sandboxing.md` §5.**

Companion documents: `sandboxing.md` (§5 host-owned pixels), `IMPLEMENTATION_PLAN.md` (§3 Frontend,
§7 the SDK UI kit). Source of truth for values: the Figma file's `🪸 Design System` page.

---

## 1. The problem this solves

`sandboxing.md` §5 states the requirement and why it is not cosmetic:

> host-tier chrome must have a visual grammar the SDK UI kit does not expose … the host tier is the
> one level a dMachine cannot render in, because the kit never gives it those tokens.

A dMachine can paint anything inside its own box, including a convincing fake consent dialog. The
sandbox guarantees the real one is host-drawn; it does not make the real one _recognisable_. The
answer is a visual grammar the guest has no vocabulary for.

## 2. The mechanism: names are fixed, values move

Tiers are **not** a light/dark user preference. They are a polarity inversion. Every surface declares
a tier; the same token _names_ resolve to different _values_ inside it.

```text
data-tier="dark"    content — agent stream, launcher popover
data-tier="light"   control — dMachine windows, cards, composers, the canvas
```

| token            | light tier | dark tier |
| ---------------- | ---------- | --------- |
| `bg/canvas`      | `#fffffa`  | `#0e1214` |
| `bg/surface`     | `#f2f2ed`  | `#16191c` |
| `bg/pill`        | `#212227`  | `#1c1f22` |
| `text/primary`   | `#14151a`  | `#ffffff` |
| `text/secondary` | `#6b6b70`  | `#a6a6ad` |
| `text/tertiary`  | `#9a9aa0`  | `#75757c` |
| `text/on-pill`   | `#b4b4b9`  | `#96969d` |
| `status/success` | `#28b45a`  | `#73e68c` |
| `status/warning` | `#be8c14`  | `#f2bf4d` |
| `status/error`   | `#d2323c`  | `#ff666b` |

Accent, on-accent, hairline, and the eight chart slots are **tier-invariant**: they are signal, not
ground, and inverting them would make an accent mean two things.

Implementation is one indirection. Raw values live on `--rz-*` and are re-declared per tier;
Tailwind's `@theme inline` maps them so a utility keeps the `var()` reference instead of inlining a
value at build time. That is what lets a component written once re-resolve wherever it lands.

**The rule for components: read token names, never literals.** A component that looks right in only
one tier has a colour hard-coded in it. Storybook's `Tier` toolbar switch exists to catch exactly
that — flip it and every story should stay legible.

## 3. Tier is a property of role, not of nesting

Tier does not cascade by depth; it is re-declared wherever the _role_ changes. The agent sidebar is
the worked example, and all three levels are visible at once:

- the sidebar declares `dark` — the message stream is **content**;
- the composer slot inside it re-declares `light` — a composer is a **control**, and controls do not
  invert with the content they sit in. This is why the composer reads as a raised white field
  against the dark panel;
- a tool-call block's nested output panel steps down again to `bg/pill`.

`DmachineWindow` declares `light` and draws its cost tab _outside_ the region the guest controls.
The guest's markup never sees the host tier's tokens, which is the §5 property expressed in code
rather than in convention.

## 4. Open questions

Carry these into the next design pass rather than letting the current values harden:

1. **Dark-tier status tints are derived, not designed.** Every Status Chip in the mockups sits on a
   light card, so `--rz-status-*-tint` in the dark tier is the status colour at 18% and wants a
   designer's sign-off.
2. **The kit's token set is not yet fenced off.** §5's guarantee only becomes structural when
   `@rhizome/dmachine-sdk` ships its own token layer that omits the host tier. Today the separation
   is convention: the host owns `apps/host/src/styles/tokens.css` and the SDK does not exist. This
   is the M4 task that closes the gap.
3. **Tool Call Block polarity.** Figma 4732:251's description asks for a light control card inside
   the dark stream; the rendered mockup shows it dark. The component follows its ambient tier, which
   reproduces the mockup — wrap it in `data-tier="light"` for the description's reading. Worth
   settling before rBudget composes against it.
4. **Two composer treatments exist.** The design-system `Chat Input` (4861:43) is a hairline pill;
   the agent-sidebar composer (4916:506) is a square white field with a 28px orb. The kit implements
   the design-system one.
