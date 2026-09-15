import type { Meta, StoryObj } from "@storybook/react-vite";

import { CategoryTable } from "./CategoryTable.tsx";
import { DonutChart } from "./DonutChart.tsx";
import { ElementPreview } from "./ElementPreview.tsx";
import { EntityRow } from "./EntityRow.tsx";
import { LegendRow } from "./LegendRow.tsx";
import { StatCard } from "./StatCard.tsx";
import { TrackRow } from "./TrackRow.tsx";
import { marks, spendRows, spendSlices } from "./fixtures.ts";

const meta = { title: "Data" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Stats: Story = {
  name: "Stat Card",
  render: () => (
    <div className="flex gap-4">
      <StatCard label="Closest Genre" value="Hyperpop" />
      <StatCard label="Closest Artist" value="Charli XCX" />
    </div>
  ),
};

export const Tracks: Story = {
  name: "Track Row",
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      <TrackRow title="Crash" subtitle="Charli XCX" />
      <TrackRow title="Von dutch" subtitle="Charli XCX" />
      <TrackRow title="A track with a name long enough to clip" subtitle="Someone Else" />
    </div>
  ),
};

export const Entities: Story = {
  render: () => (
    <div className="flex w-100 flex-col">
      <EntityRow title="Orient to win" meta="12 objects" onSelect={() => undefined} />
      <EntityRow title="Love always wins" subtitle="Are.na channel" meta="28 objects" />
    </div>
  ),
};

export const MediaPreview: Story = {
  render: () => (
    <div className="flex aspect-[4/3] w-72 items-center justify-center overflow-hidden rounded-card bg-canvas">
      <ElementPreview title="App artwork" kind="image" mime="image/png" src={marks.app} />
    </div>
  ),
};

export const Legend: Story = {
  name: "Legend Row",
  render: () => (
    <div className="flex w-90 flex-col">
      {spendRows.slice(0, 4).map((row) => (
        <LegendRow
          key={row.label}
          slot={row.slot}
          label={row.label}
          amount={row.amount}
          share={row.share}
        />
      ))}
    </div>
  ),
};

export const Table: Story = {
  name: "Category Table",
  render: () => (
    <div className="w-140">
      <CategoryTable
        entries={spendRows}
        total={{ label: "Total", amount: "$37,717.83", share: "100%" }}
      />
    </div>
  ),
};

export const Donut: Story = {
  name: "Donut Chart",
  render: () => (
    <DonutChart
      slices={spendSlices}
      caption="TOTAL SPEND"
      value="$37,718"
      footnote="MAY 26 – AUG 17"
    />
  ),
};

/** The donut and its legend as they compose on the rBudget spending card. */
export const SpendingCard: Story = {
  render: () => (
    <div className="flex w-fit items-center gap-12 rounded-lg bg-surface px-8 py-7">
      <DonutChart
        slices={spendSlices}
        caption="TOTAL SPEND"
        value="$37,718"
        footnote="MAY 26 – AUG 17"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {spendRows.map((row) => (
          <LegendRow
            key={row.label}
            slot={row.slot}
            label={row.label}
            amount={row.amount}
            share={row.share}
            className="w-100"
          />
        ))}
      </div>
    </div>
  ),
};
