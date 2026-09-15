# Design tiers

**Status: implemented in `apps/host/src/styles/tokens.css` and the Storybook UI kit.**

Companion documents: [sandboxing exploration](../speculative/sandboxing.md) (§5 host-owned pixels),
[implementation plan](../IMPLEMENTATION_PLAN.md) (§3 Frontend, §7 the SDK UI kit).
The original palette comes from the Figma file's `🪸 Design System` page; shipped values live in
`apps/host/src/styles/tokens.css`, including readable status/muted text and dark desktop surfaces.

---

## 1. The problem this solves

The original motivation came from §5 of the now-speculative [sandboxing note](../speculative/sandboxing.md):

> host-tier chrome must have a visual grammar the SDK UI kit does not expose … the host tier is the
> one level a dMachine cannot render in, because the kit never gives it those tokens.

That sandbox proposal is exploratory, not an implementation requirement. The design choice retained
here is literal light/dark polarity inversion between control and content layers.

## 2. The mechanism: names are fixed, values move

Theme follows the operating system through `prefers-color-scheme`. Tiers describe roles and keep
literal light/dark inversion in both system themes. Every surface declares a role; the same token
_names_ resolve to different _values_ inside it.

```text
data-tier="control" — desktop, windows, cards, launcher/search, composers
data-tier="content" — dock, agent sidebar and message stream, floating action tooltips
```

- Light system: control is light, content is dark.
- Dark system: control is dark, content is light.

CSS chooses `--rz-control-scheme` and `--rz-content-scheme`; each tier applies its scheme through
`color-scheme`, which also themes native inputs, selects, scrollbars, and media controls. Color
tokens use `light-dark(light, dark)` and resolve against the consuming element's scheme. This uses
modern browser support (`light-dark()` colors are Baseline 2024), consistent with the host's modern
CSS baseline. `ThemeProvider` follows system changes until the launcher sets a light/dark
override. That override is stored in `sessionStorage` for the tab session and applied through
the root `data-theme` attribute. It is not a persistent account preference.

Both the Vite app build and Storybook's final Vite config share `HOST_CSS_TARGET` so the compiler
preserves native `light-dark()` colors. Lowering them for older browsers cannot follow the
variable-driven per-tier `color-scheme` and produces invalid colors; verify the built output as
well as the development server when changing this configuration.

The desktop uses the existing light wallpaper with its 75% white overlay, or the supplied
`wallpaper-dark.png` without an overlay. Home panels and Vibe card gradients also adapt. Images,
video pixels, and PDF document contents retain their original appearance; host-rendered text
previews follow the surrounding theme. The early HTML color-scheme meta tag declares both themes
before styles load.

Accent, on-accent, hairline, and the eight chart slots are **tier-invariant**: they are signal, not
ground, and inverting them would make an accent mean two things.

Raw values live on `--rz-*`; Tailwind's `@theme inline` maps them so a utility keeps the `var()`
reference. Native CSS resolves the light/dark color at the element where it is used, including
translucent dock fills and nested controls.

**The rule for components: read token names, never literals.** A component that looks right in only
one tier has a colour hard-coded in it. Storybook has independent `Theme` (System/Light/Dark) and
`Tier` (Control/Content) toolbar switches. Its scoped `data-theme` preview override changes both
layer schemes and wallpaper without adding an application preference.

## 3. Tier is a property of role, not of nesting

Tier does not cascade by depth; it is re-declared wherever the _role_ changes. The agent sidebar is
the worked example, and all three levels are visible at once:

- the sidebar declares `content` — dark in light mode, light in dark mode;
- the composer slot inside it re-declares `control` — light against the dark stream in light mode,
  dark against the light stream in dark mode;
- a tool-call block's nested output panel steps down again to `bg/pill`.

`DmachineWindow` declares `control` and draws its cost tab _outside_ the region the guest controls,
following implementation plan §7's requirement for host-owned cost display.

## 4. Desktop and window lifetime

The desktop mounts when first visited and remains in React `Activity` behind page windows.
Hiding it preserves its DOM, component state, and scroll position while pausing effects,
query subscriptions, its minute clock, and live orb work. A direct page load does not mount an
unseen desktop. Cards fetch collections and previews only near the viewport. Image previews
use authorized 64px thumbnails whose small blobs remain cached for five minutes after the
last subscription, so short cover/reveal cycles do not download them again.

Only the focused page window mounts; Home mounts no page window. Recent and pinned routes are
metadata that can reopen windows. Page-window component drafts and scroll state may be lost on
navigation. Escape first belongs to active editors and dialogs: a title save in progress and
the object JSON editor keep their window open.

## 5. Open questions

Carry these into the next design pass rather than letting the current values harden:

1. **Dark-tier status tints are derived, not designed.** Every Status Chip in the mockups sits on a
   light card, so `--rz-status-*-tint` in the dark tier is the status colour at 18% and wants a
   designer's sign-off.
2. **A separate kit token set is exploratory.** The [sandboxing note](../speculative/sandboxing.md)
   proposes an SDK token layer that omits the host tier. Today the host owns
   `apps/host/src/styles/tokens.css` and the SDK does not exist. That proposed token restriction
   is not an implementation requirement.
3. **Tool Call Block polarity.** Figma 4732:251's description asks for a light control card inside
   the dark stream; the rendered mockup shows it dark. The component follows its ambient tier, which
   reproduces the mockup — wrap it in `data-tier="control"` for the description's reading. Worth
   settling before rBudget composes against it.
4. **Two composer treatments exist.** The design-system `Chat Input` (4861:43) is a hairline pill;
   the agent-sidebar composer (4916:506) is a square white field with a 28px orb. The kit implements
   the design-system one.
