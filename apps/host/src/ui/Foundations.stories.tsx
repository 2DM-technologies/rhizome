import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Foundations/Tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const TIER_COLORS = [
  ["bg/canvas", "--rz-bg-canvas"],
  ["bg/surface", "--rz-bg-surface"],
  ["bg/pill", "--rz-bg-pill"],
  ["text/primary", "--rz-text-primary"],
  ["text/secondary", "--rz-text-secondary"],
  ["text/tertiary", "--rz-text-tertiary"],
  ["text/on-pill", "--rz-text-on-pill"],
  ["status/success", "--rz-status-success"],
  ["status/warning", "--rz-status-warning"],
  ["status/error", "--rz-status-error"],
] as const;

const INVARIANT_COLORS = [
  ["accent/primary", "--rz-accent-primary"],
  ["accent/secondary", "--rz-accent-secondary"],
  ["text/on-accent", "--rz-text-on-accent"],
  ["border/hairline", "--rz-border-hairline"],
] as const;

const TYPE_RAMP = [
  ["Display · 34 Bold", "text-display", "Vibe-based computing"],
  ["Heading · 20 Medium", "text-heading", "Start something new"],
  ["Body Large · 16 Regular", "text-body-lg", "Dreamy. Upbeat. Frenetic."],
  ["Body · 14 Regular", "text-body", "Found it — verify.ts assumes merchant is always present."],
  ["Label · 13 Medium", "text-label", "Save to Library"],
  ["Caption · 12 Regular", "text-caption", "Noah's Airpods #7"],
  ["Mono Label · 11 Medium", "text-mono-label", "ENERGY · MOOD"],
] as const;

function Swatch({ name, variable }: { name: string; variable: string }) {
  return (
    <div className="flex items-center gap-4">
      <span
        className="size-8 shrink-0 rounded-sm border border-black/10"
        style={{ background: `var(${variable})` }}
      />
      <span className="min-w-0 flex-1 truncate text-label text-primary">{name}</span>
    </div>
  );
}

function TierColumn({ tier }: { tier: "light" | "dark" }) {
  return (
    <div data-tier={tier} className="flex flex-col gap-3 rounded-md bg-canvas p-6">
      <span className="text-mono-label text-tertiary">{tier.toUpperCase()} TIER</span>
      {TIER_COLORS.map(([name, variable]) => (
        <Swatch key={name} name={name} variable={variable} />
      ))}
    </div>
  );
}

/**
 * The token set, both tiers at once. The two columns share every token *name* — only the
 * values differ. A component reads names, so it inverts by being placed, not by being told.
 */
export const Color: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6">
        <TierColumn tier="light" />
        <TierColumn tier="dark" />
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-mono-label text-tertiary">TIER-INVARIANT — signal, not ground</span>
        <div className="grid grid-cols-2 gap-3">
          {INVARIANT_COLORS.map(([name, variable]) => (
            <Swatch key={name} name={name} variable={variable} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-mono-label text-tertiary">CHART — categorical, tier-invariant</span>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
            <span
              key={slot}
              className="size-10 rounded-sm"
              style={{ background: `var(--rz-chart-${slot})` }}
              title={`chart/${slot}`}
            />
          ))}
        </div>
      </div>
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {TYPE_RAMP.map(([name, className, sample]) => (
        <div key={name} className="flex items-baseline gap-8">
          <span className="w-56 shrink-0 text-caption text-tertiary">{name}</span>
          <span className={`${className} text-primary`}>{sample}</span>
        </div>
      ))}
    </div>
  ),
};

export const SpacingAndRadius: Story = {
  render: () => (
    <div className="flex flex-col gap-10">
      <div className="flex items-end gap-8">
        {[
          ["xs", 4],
          ["sm", 8],
          ["md", 12],
          ["lg", 16],
          ["xl", 24],
          ["2xl", 32],
          ["3xl", 48],
        ].map(([name, size]) => (
          <div key={name as string} className="flex flex-col items-center gap-3">
            <span className="rounded-[2px] bg-accent" style={{ width: size, height: size }} />
            <span className="text-caption text-tertiary">{`${name} · ${size}`}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-8">
        {[
          ["sm", "rounded-sm", 8],
          ["md", "rounded-md", 12],
          ["lg", "rounded-lg", 20],
          ["pill", "rounded-pill", 999],
        ].map(([name, className, value]) => (
          <div key={name as string} className="flex flex-col items-center gap-3">
            <span className={`h-14 w-24 bg-surface border border-hairline ${className}`} />
            <span className="text-caption text-tertiary">{`${name} · ${value}`}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
