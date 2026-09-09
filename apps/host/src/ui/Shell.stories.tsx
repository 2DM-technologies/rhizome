import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";

import { AgentSidebar } from "./AgentSidebar.tsx";
import { CategoryTable } from "./CategoryTable.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ChatMessage } from "./ChatMessage.tsx";
import { CodeSnippet } from "./CodeSnippet.tsx";
import { Desktop } from "./Desktop.tsx";
import { DmachineWindow } from "./DmachineWindow.tsx";
import { Dock, DockDivider, DockSegment, DockTray } from "./Dock.tsx";
import { DockApp } from "./DockApp.tsx";
import { DonutChart } from "./DonutChart.tsx";
import { FileChip } from "./FileChip.tsx";
import { LauncherItem } from "./LauncherItem.tsx";
import { LauncherPanel } from "./LauncherPanel.tsx";
import { LegendRow } from "./LegendRow.tsx";
import { SearchField } from "./SearchField.tsx";
import { Select } from "./Select.tsx";
import { Tabs } from "./Tabs.tsx";
import { ToolCallBlock } from "./ToolCallBlock.tsx";
import { VibeOrb } from "./VibeOrb.tsx";
import { marks, orbs, spendRows, spendSlices } from "./fixtures.ts";

const meta = { title: "Shell", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const DIFF = [
  { kind: "remove" as const, text: "if (record.merchant) {" },
  { kind: "add" as const, text: "if (record.merchant ?? record.description) {" },
  { kind: "context" as const, text: "  return normalize(record.merchant);" },
];
const LOG = [
  { tone: "success" as const, text: "✓ verify.test.ts (4)" },
  { tone: "success" as const, text: "✓ ingest.test.ts (11)" },
  { tone: "muted" as const, text: "15 passed · 0 failed · 340ms" },
];

function TrayContents({ search }: { search: ReactNode }) {
  return (
    <>
      <div className="flex min-w-0 shrink items-center gap-5 overflow-hidden">
        <DockApp name="Spending" src={orbs.a} />
        <DockApp name="Library" src={orbs.b} />
      </div>
      <DockDivider />
      {search}
      <div className="flex min-w-0 shrink items-center gap-5 overflow-hidden">
        <DockApp name="Reading" src={orbs.c} />
        <DockApp name="People" src={orbs.d} />
      </div>
    </>
  );
}

export const Apps: Story = {
  name: "Dock App",
  render: () => (
    <div className="flex items-center gap-6 rounded-md bg-dock-tray p-4">
      <DockApp name="Rhizome" src={marks.app} state="active" />
      <DockApp name="Spending" src={orbs.a} />
      <DockApp name="Library" src={orbs.b} />
    </div>
  ),
};

/** Figma 4861:104, at rest. */
export const DockAtRest: Story = {
  name: "Dock",
  render: () => (
    <div className="p-8">
      <Dock
        leading={<VibeOrb src={orbs.home} size="lg" />}
        apps={<DockApp name="Rhizome" src={marks.app} state="active" />}
        tray={
          <DockTray>
            <TrayContents search={<SearchField containerClassName="shrink-0" />} />
          </DockTray>
        }
      />
    </div>
  ),
};

/**
 * The bento. Every toggle changes what one segment wants, and the rest give way: the tray is
 * the only segment that grows, so opening the agent panel or a trailing island narrows it,
 * and expanding the launcher widens the search slot inside it. Nothing is positioned
 * absolutely to make this work — the segments negotiate.
 */
export const DockBento: Story = {
  name: "Dock — fluid bento",
  render: function Render() {
    const [agentOpen, setAgentOpen] = useState(false);
    const [launcherOpen, setLauncherOpen] = useState(false);
    const [islandOpen, setIslandOpen] = useState(false);
    const [query, setQuery] = useState("");

    const toggles: [string, boolean, (next: boolean) => void][] = [
      ["Agent panel", agentOpen, setAgentOpen],
      ["Launcher", launcherOpen, setLauncherOpen],
      ["Trailing island", islandOpen, setIslandOpen],
    ];

    return (
      <div className="flex h-screen flex-col justify-between p-8">
        <div className="flex gap-3">
          {toggles.map(([label, on, set]) => (
            <button
              key={label}
              type="button"
              onClick={() => set(!on)}
              className={`rounded-pill px-4 py-2 text-label ${
                on ? "bg-accent text-on-accent" : "bg-surface border border-hairline text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Dock
          leading={
            agentOpen ? (
              <AgentSidebar
                className="h-[480px]"
                composer={<ChatInput orbSrc={orbs.user} placeholder="What's the move, Noah?" />}
              >
                <ChatMessage sender="you">
                  the dry-run is failing on origins with missing merchant field, can you fix
                </ChatMessage>
                <ChatMessage sender="rhizome">
                  Found it — verify.ts assumes merchant is always present.
                </ChatMessage>
                <FileChip path="src/ingest/verify.ts" />
                <CodeSnippet lines={DIFF} />
                <ToolCallBlock
                  title="⚙ Run: bun test ingest"
                  status="success"
                  statusLabel="passed"
                  lines={LOG}
                />
              </AgentSidebar>
            ) : (
              <VibeOrb src={orbs.home} size="lg" />
            )
          }
          apps={<DockApp name="Rhizome" src={marks.app} state="active" />}
          tray={
            <DockTray>
              <TrayContents
                search={
                  <div className="relative h-12 w-60 shrink-0">
                    <LauncherPanel
                      open={launcherOpen}
                      query={query}
                      onQueryChange={setQuery}
                      onOpen={() => setLauncherOpen(true)}
                      onDismiss={() => setLauncherOpen(false)}
                      sections={[
                        {
                          title: "Commands",
                          items: (
                            <>
                              <LauncherItem label="Open Vibes" icon="⌘" />
                              <LauncherItem label="Show Desktop" icon="⌘" />
                            </>
                          ),
                        },
                        {
                          title: "Vibes",
                          items: (
                            <>
                              <LauncherItem label="Spending" icon="◉" />
                              <LauncherItem label="Library" icon="◉" />
                              <LauncherItem label="Trip planning" icon="◉" />
                              <LauncherItem label="Reading list" icon="◉" />
                            </>
                          ),
                        },
                      ]}
                    />
                  </div>
                }
              />
            </DockTray>
          }
          trailing={
            islandOpen ? (
              <DockSegment className="h-16 shrink-0 items-center rounded-[16px] bg-dock-tray px-4">
                <span className="text-label text-primary whitespace-nowrap">Trailing island</span>
              </DockSegment>
            ) : null
          }
        />
      </div>
    );
  },
};

export const Launcher: Story = {
  name: "Launcher Panel",
  render: function Render() {
    const [query, setQuery] = useState("");
    return (
      <div className="p-8">
        <div className="relative h-[36rem] w-[308px]">
          <LauncherPanel
            query={query}
            onQueryChange={setQuery}
            sections={[
              {
                title: "Commands",
                items: (
                  <>
                    <LauncherItem label="Open Vibes" icon="⌘" />
                    <LauncherItem label="Show Desktop" icon="⌘" />
                  </>
                ),
              },
              {
                title: "Vibes",
                items: (
                  <>
                    <LauncherItem label="Spending" icon="◉" />
                    <LauncherItem label="Library" icon="◉" />
                    <LauncherItem label="Trip planning" icon="◉" />
                    <LauncherItem label="Reading list" icon="◉" />
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
    );
  },
};

/** Figma 4916:397 — the frame a dMachine runs in, with the host-drawn cost tab. */
export const Window: Story = {
  name: "dMachine Window",
  render: function Render() {
    const [view, setView] = useState<"spending" | "earnings">("spending");
    return (
      <div className="p-8">
        <DmachineWindow model="GPT-5.6 Sol" cost="$0.24" className="w-[1000px]">
          <div className="flex w-full items-center gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[24px] leading-none font-bold text-primary">
                Budget breakdown
              </span>
              <span className="text-label font-normal text-secondary">
                Chase card 3065 + Citi checking 8708 · refunds netted
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="text-label font-normal text-tertiary">Date range</span>
              <Select value="All data (May 26 – Aug 17)" />
            </div>
          </div>
          <Tabs
            label="Budget view"
            value={view}
            onChange={setView}
            options={[
              { value: "spending", label: "Spending" },
              { value: "earnings", label: "Earnings" },
            ]}
          />
          <div className="flex w-full items-center gap-12 rounded-lg bg-surface px-8 py-7">
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
                />
              ))}
            </div>
          </div>
          <div className="w-full rounded-lg bg-surface px-8 py-6">
            <CategoryTable
              entries={spendRows}
              total={{ label: "Total", amount: "$37,717.83", share: "100%" }}
            />
          </div>
        </DmachineWindow>
      </div>
    );
  },
};

/** The four desktop states from the mockups, reproduced from the components above. */
export const DesktopEmpty: Story = {
  name: "Desktop — empty",
  render: () => (
    <div className="h-screen">
      <Desktop
        dock={
          <Dock
            leading={<VibeOrb src={orbs.home} size="lg" />}
            apps={<DockApp name="Rhizome" src={marks.app} state="active" />}
            tray={
              <DockTray>
                <TrayContents search={<SearchField containerClassName="shrink-0" />} />
              </DockTray>
            }
          />
        }
      />
    </div>
  ),
};

export const DesktopWithAgent: Story = {
  name: "Desktop — agent open",
  render: () => (
    <div className="h-screen">
      <Desktop
        dock={
          <Dock
            leading={
              <AgentSidebar
                className="h-[575px]"
                composer={<ChatInput orbSrc={orbs.user} placeholder="What's the move, Noah?" />}
              >
                <ChatMessage sender="you">
                  the dry-run is failing on origins with missing merchant field, can you fix
                </ChatMessage>
                <ChatMessage sender="rhizome">
                  Found it — verify.ts assumes merchant is always present. Updating the null check.
                </ChatMessage>
                <FileChip path="src/ingest/verify.ts" />
                <CodeSnippet lines={DIFF} />
                <ToolCallBlock
                  title="⚙ Run: bun test ingest"
                  status="success"
                  statusLabel="passed"
                  lines={LOG}
                />
                <ChatMessage sender="rhizome">All tests pass. Ready to push the fix?</ChatMessage>
              </AgentSidebar>
            }
            apps={<DockApp name="Rhizome" src={marks.app} state="active" />}
            tray={
              <DockTray>
                <TrayContents search={<SearchField containerClassName="shrink-0" />} />
              </DockTray>
            }
          />
        }
      />
    </div>
  ),
};
