import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./Button.tsx";
import { MenuItem } from "./MenuItem.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { SearchField } from "./SearchField.tsx";
import { Select } from "./Select.tsx";
import { StatusChip } from "./StatusChip.tsx";
import { Tabs } from "./Tabs.tsx";
import { VibeOrb } from "./VibeOrb.tsx";
import { orbs } from "./fixtures.ts";

const meta = { title: "Primitives" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  name: "Button",
  render: () => (
    <div className="flex items-center gap-4">
      <Button variant="primary">Save to Library</Button>
      <Button variant="secondary">Save to Library</Button>
      <Button variant="ghost">Save to Library</Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
    </div>
  ),
};

export const Status: Story = {
  name: "Status Chip",
  render: () => (
    <div className="flex items-center gap-4">
      <StatusChip status="success">passed</StatusChip>
      <StatusChip status="error">error</StatusChip>
      <StatusChip status="neutral">neutral</StatusChip>
    </div>
  ),
};

export const Search: Story = {
  name: "Search Field",
  render: () => <SearchField />,
};

export const Progress: Story = {
  name: "Progress Bar",
  render: () => (
    <div className="flex flex-col gap-4">
      <ProgressBar value={0.5} label="Importing" />
      <ProgressBar value={0.12} label="Importing" />
      <ProgressBar value={1} label="Importing" />
    </div>
  ),
};

export const SegmentedTabs: Story = {
  name: "Tabs",
  render: function Render() {
    const [value, setValue] = useState<"spending" | "earnings">("spending");
    return (
      <Tabs
        label="Budget view"
        value={value}
        onChange={setValue}
        options={[
          { value: "spending", label: "Spending" },
          { value: "earnings", label: "Earnings" },
        ]}
      />
    );
  },
};

export const SelectAndMenu: Story = {
  name: "Select + Menu Item",
  render: function Render() {
    const options = ["All data (May 26 – Aug 17)", "June 2026", "July 2026"];
    const [selected, setSelected] = useState(options[0]!);
    return (
      <div className="flex flex-col items-start gap-6">
        <Select value={selected} />
        <div
          role="menu"
          aria-label="Date range"
          className="flex flex-col gap-0.5 rounded-sm border border-hairline bg-canvas p-1.5"
        >
          {options.map((option) => (
            <MenuItem
              key={option}
              label={option}
              selected={option === selected}
              onSelect={() => setSelected(option)}
            />
          ))}
        </div>
      </div>
    );
  },
};

export const Orb: Story = {
  name: "Vibe Orb",
  render: () => (
    <div className="flex items-end gap-6">
      <div className="flex flex-col items-center gap-2">
        <VibeOrb src={orbs.small} size="sm" />
        <span className="text-caption text-tertiary">sm · 20</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <VibeOrb src={orbs.a} size="md" />
        <span className="text-caption text-tertiary">md · 44</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <VibeOrb src={orbs.home} size="lg" />
        <span className="text-caption text-tertiary">lg · 48</span>
      </div>
    </div>
  ),
};
