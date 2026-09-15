import { useState } from "react";

import { ProceduralVibeOrb } from "./ProceduralVibeOrb.tsx";
import {
  ORB_PRESETS,
  composeVibeOrb,
  normalizeOrbRecipe,
  type OrbPresetName,
  type OrbVisualRecipe,
} from "./recipe.ts";
import type { OrbMotionMode } from "./renderer.ts";
import { fallbackOrbRecipe } from "./vibeRecipe.ts";

interface ScalarControl {
  label: string;
  read: (recipe: OrbVisualRecipe) => number;
  write: (recipe: OrbVisualRecipe, value: number) => OrbVisualRecipe;
}

const FIELD_CONTROLS: ScalarControl[] = [
  {
    label: "Pattern scale",
    read: ({ field }) => field.grain,
    write: (recipe, grain) => ({ ...recipe, field: { ...recipe.field, grain } }),
  },

  {
    label: "Warp",
    read: ({ field }) => field.warp,
    write: (recipe, warp) => ({ ...recipe, field: { ...recipe.field, warp } }),
  },

  {
    label: "Ribbons",
    read: ({ field }) => field.anisotropy,
    write: (recipe, anisotropy) => ({ ...recipe, field: { ...recipe.field, anisotropy } }),
  },
];

const SURFACE_CONTROLS: ScalarControl[] = [
  {
    label: "Depth",
    read: ({ surface }) => surface.depth,
    write: (recipe, depth) => ({ ...recipe, surface: { ...recipe.surface, depth } }),
  },
  {
    label: "Glow",
    read: ({ surface }) => surface.glow,
    write: (recipe, glow) => ({ ...recipe, surface: { ...recipe.surface, glow } }),
  },
];
const MOTION_CONTROLS: ScalarControl[] = [
  {
    label: "Drift",
    read: ({ motion }) => motion.drift,
    write: (recipe, drift) => ({ ...recipe, motion: { ...recipe.motion, drift } }),
  },
  {
    label: "Turbulence",
    read: ({ motion }) => motion.turbulence,
    write: (recipe, turbulence) => ({ ...recipe, motion: { ...recipe.motion, turbulence } }),
  },
  {
    label: "Spin",
    read: ({ motion }) => motion.spin,
    write: (recipe, spin) => ({ ...recipe, motion: { ...recipe.motion, spin } }),
  },
];

const PRESET_LABELS: Record<OrbPresetName, string> = {
  bloom: "Bloom",
  ember: "Ember",
  tideglass: "Tideglass",
  lichen: "Lichen",
};

function copyRecipe(recipe: OrbVisualRecipe): OrbVisualRecipe {
  return {
    ...recipe,
    palette: recipe.palette.map((stop) => ({ ...stop })),
    field: { ...recipe.field },
    surface: { ...recipe.surface },
    motion: { ...recipe.motion },
  };
}

function Slider({
  control,
  recipe,
  onChange,
}: {
  control: ScalarControl;
  recipe: OrbVisualRecipe;
  onChange: (next: OrbVisualRecipe) => void;
}) {
  const value = control.read(recipe);
  return (
    <label className="grid grid-cols-[minmax(7rem,1fr)_minmax(7rem,1.25fr)_2.5rem] items-center gap-2 text-[11px] leading-none text-secondary">
      <span>{control.label}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        aria-label={control.label}
        onChange={(event) => onChange(control.write(recipe, Number(event.currentTarget.value)))}
        className="vibe-orb-range w-full accent-[var(--rz-accent-primary)]"
      />
      <output className="text-right font-mono text-[10px] text-tertiary">{value.toFixed(2)}</output>
    </label>
  );
}

function ControlGroup({
  title,
  controls,
  recipe,
  onChange,
}: {
  title: string;
  controls: ScalarControl[];
  recipe: OrbVisualRecipe;
  onChange: (next: OrbVisualRecipe) => void;
}) {
  return (
    <fieldset className="grid gap-3 border-t border-hairline pt-4">
      <legend className="mb-1 pr-2 text-[10px] font-semibold tracking-[0.12em] text-tertiary uppercase">
        {title}
      </legend>
      {controls.map((control) => (
        <Slider key={control.label} control={control} recipe={recipe} onChange={onChange} />
      ))}
    </fieldset>
  );
}

function InteractionPreview({
  recipe,
  size,
  label,
  motion,
}: {
  recipe: OrbVisualRecipe;
  size: number;
  label: string;
  motion: "continuous" | "interaction";
}) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className="group flex min-w-20 flex-col items-center gap-2 rounded-md p-3 text-[10px] text-secondary transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
    >
      <ProceduralVibeOrb recipe={recipe} motion={motion} active={active} size={size} />
      <span>{label}</span>
    </button>
  );
}

export function VibeOrbPlayground() {
  const [recipe, setRecipe] = useState(() => copyRecipe(ORB_PRESETS.bloom));
  const [selectedPreset, setSelectedPreset] = useState<OrbPresetName | null>("bloom");
  const [motion, setMotion] = useState<OrbMotionMode>("continuous");
  const [contributions, setContributions] = useState<Record<OrbPresetName, number>>({
    bloom: 1,
    ember: 0,
    tideglass: 0,
    lichen: 0,
  });

  const compose = (next: Record<OrbPresetName, number>) => {
    setContributions(next);
    setSelectedPreset(null);
    setRecipe(
      composeVibeOrb(
        recipe.seed,
        (Object.keys(next) as OrbPresetName[]).map((name) => ({
          id: name,
          character: ORB_PRESETS[name],
          weight: next[name],
        })),
      ) ?? fallbackOrbRecipe(recipe.seed),
    );
  };

  const updateRecipe = (next: OrbVisualRecipe) => {
    setSelectedPreset(null);
    setRecipe(normalizeOrbRecipe(next));
  };

  const choosePreset = (name: OrbPresetName) => {
    setSelectedPreset(name);
    setRecipe(copyRecipe(ORB_PRESETS[name]));
  };

  return (
    <main
      data-tier="control"
      data-vibe-orb-playground
      className="min-h-screen bg-canvas text-primary"
    >
      <header className="flex items-end justify-between gap-6 border-b border-hairline px-6 py-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-tertiary uppercase">
            Renderer playground · recipe v{recipe.version}
          </p>
          <h1 className="font-serif text-[34px] leading-none tracking-[-0.02em]">Vibe orb</h1>
        </div>
        <p className="w-[28rem] max-w-[50vw] shrink-0 text-right text-[12px] leading-relaxed text-secondary">
          Compose media contributions or tune each orb’s palette, pattern, depth, glow, and
          independent motion.
        </p>
      </header>

      <div className="grid min-h-[calc(100vh-94px)] grid-cols-[minmax(0,1fr)_24rem] max-[900px]:grid-cols-1">
        <section className="min-w-0 p-6">
          <div className="vibe-orb-stage relative flex min-h-[500px] items-center justify-center overflow-hidden rounded-lg border border-hairline bg-pill">
            <div className="vibe-orb-stage-grid absolute inset-0 opacity-50" />
            <div className="absolute top-5 left-5 z-10 flex items-center gap-2 rounded-pill border border-hairline bg-canvas/80 p-1 backdrop-blur-md">
              {(["continuous", "interaction", "still"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={motion === mode}
                  onClick={() => setMotion(mode)}
                  className="rounded-pill px-3 py-1.5 text-[10px] font-medium text-secondary capitalize aria-pressed:bg-accent aria-pressed:text-on-accent"
                >
                  {mode}
                </button>
              ))}
            </div>
            <ProceduralVibeOrb
              recipe={recipe}
              motion={motion}
              size="min(66vw, 430px)"
              label="Large procedural Vibe orb preview"
              className="drop-shadow-[0_28px_38px_rgb(16_12_30/20%)]"
            />
          </div>

          <fieldset className="mt-5 rounded-lg border border-hairline bg-pill p-4">
            <legend className="px-2 text-[11px] font-semibold text-secondary">
              Compose from media objects
            </legend>
            <p className="mb-3 text-[11px] text-secondary">
              Try a collection of different object characters. Each object has one vote; colors
              combine by hue and the other controls average independently.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {(Object.keys(contributions) as OrbPresetName[]).map((name) => (
                <label
                  key={name}
                  className="grid grid-cols-[5rem_1fr_1rem] items-center gap-2 text-[11px] text-secondary"
                >
                  <span>{PRESET_LABELS[name]}</span>
                  <input
                    className="vibe-orb-range w-full accent-[var(--rz-accent-primary)]"
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    aria-label={`${PRESET_LABELS[name]} objects`}
                    value={contributions[name]}
                    onChange={(event) =>
                      compose({ ...contributions, [name]: Number(event.currentTarget.value) })
                    }
                  />
                  <output>{contributions[name]}</output>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 grid gap-5 xl:grid-cols-[auto_1fr]">
            <div>
              <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-tertiary uppercase">
                Actual UI sizes · hover or focus
              </p>
              <div className="flex flex-wrap items-end gap-1 rounded-lg border border-hairline bg-pill p-2">
                <InteractionPreview
                  recipe={recipe}
                  size={20}
                  label="List · 20"
                  motion="interaction"
                />
                <InteractionPreview
                  recipe={recipe}
                  size={44}
                  label="Card · 44"
                  motion="interaction"
                />
                <InteractionPreview
                  recipe={recipe}
                  size={48}
                  label="Dock · 48"
                  motion="continuous"
                />
                <InteractionPreview
                  recipe={recipe}
                  size={72}
                  label="Hero · 72"
                  motion="continuous"
                />
              </div>
            </div>

            <div className="min-w-0">
              <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-tertiary uppercase">
                Range check · 44px
              </p>
              <div className="flex min-h-[102px] flex-wrap items-center gap-5 rounded-lg border border-hairline bg-pill px-5 py-3">
                {(Object.keys(ORB_PRESETS) as OrbPresetName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => choosePreset(name)}
                    className="flex flex-col items-center gap-1.5 rounded-sm text-[10px] text-secondary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                  >
                    <ProceduralVibeOrb recipe={ORB_PRESETS[name]} motion="still" size={44} />
                    <span>{PRESET_LABELS[name]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="border-l border-hairline bg-surface p-5 max-[900px]:border-t max-[900px]:border-l-0">
          <div className="mb-5 grid grid-cols-4 gap-1">
            {(Object.keys(ORB_PRESETS) as OrbPresetName[]).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={selectedPreset === name}
                onClick={() => choosePreset(name)}
                className="rounded-sm border border-transparent px-2 py-2 text-[10px] font-medium text-secondary hover:bg-pill aria-pressed:border-accent aria-pressed:text-primary"
              >
                {PRESET_LABELS[name]}
              </button>
            ))}
          </div>

          <label className="mb-5 grid gap-1 text-[10px] font-semibold tracking-[0.12em] text-tertiary uppercase">
            Deterministic seed
            <input
              value={recipe.seed}
              onChange={(event) => updateRecipe({ ...recipe, seed: event.currentTarget.value })}
              className="mt-1 min-w-0 rounded-sm border border-hairline bg-canvas px-2.5 py-2 font-mono text-[10px] font-normal tracking-normal text-primary normal-case outline-none focus:border-accent"
            />
          </label>

          <fieldset className="grid gap-3 border-t border-hairline pt-4">
            <legend className="mb-1 pr-2 text-[10px] font-semibold tracking-[0.12em] text-tertiary uppercase">
              Palette
            </legend>
            {recipe.palette.map((stop, index) => (
              <div
                key={index}
                className="grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] items-center gap-2"
              >
                <input
                  type="color"
                  value={stop.color}
                  aria-label={`Palette color ${index + 1}`}
                  onChange={(event) => {
                    const palette = recipe.palette.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, color: event.currentTarget.value as `#${string}` }
                        : item,
                    );
                    updateRecipe({ ...recipe, palette });
                  }}
                  className="size-7 cursor-pointer overflow-hidden rounded-full border-0 bg-transparent p-0"
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={stop.weight}
                  aria-label={`Palette weight ${index + 1}`}
                  onChange={(event) => {
                    const weight = Number(event.currentTarget.value);
                    const palette = recipe.palette.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, weight } : item,
                    );
                    updateRecipe({ ...recipe, palette });
                  }}
                  className="vibe-orb-range w-full accent-[var(--rz-accent-primary)]"
                />
                <output className="text-right font-mono text-[10px] text-tertiary">
                  {stop.weight.toFixed(2)}
                </output>
              </div>
            ))}
            <Slider
              control={{
                label: "Contrast",
                read: (value) => value.contrast,
                write: (value, contrast) => ({ ...value, contrast }),
              }}
              recipe={recipe}
              onChange={updateRecipe}
            />
          </fieldset>

          <p className="mt-5 text-[11px] leading-relaxed text-secondary">
            Rounded pools, flowing ribbons, shallow glass, deep lensing, and independent movement.
            The polished shell stays consistent.
          </p>
          <div className="mt-5 grid gap-5">
            <ControlGroup
              title="Field"
              controls={FIELD_CONTROLS}
              recipe={recipe}
              onChange={updateRecipe}
            />
            <ControlGroup
              title="Surface"
              controls={SURFACE_CONTROLS}
              recipe={recipe}
              onChange={updateRecipe}
            />
            <ControlGroup
              title="Motion"
              controls={MOTION_CONTROLS}
              recipe={recipe}
              onChange={updateRecipe}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
