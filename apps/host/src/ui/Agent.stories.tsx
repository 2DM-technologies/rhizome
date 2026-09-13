import type { Meta, StoryObj } from "@storybook/react-vite";

import { AgentSidebar } from "./AgentSidebar.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ChatMessage } from "./ChatMessage.tsx";
import { CodeSnippet } from "./CodeSnippet.tsx";
import { FileChip } from "./FileChip.tsx";
import { ToolCallBlock } from "./ToolCallBlock.tsx";
import { orbs } from "./fixtures.ts";

const meta = { title: "Agent" } satisfies Meta;
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

export const Messages: Story = {
  name: "Chat Message",
  render: () => (
    <div className="flex w-70 flex-col gap-4">
      <ChatMessage sender="you">
        the dry-run is failing on origins with missing merchant field, can you fix
      </ChatMessage>
      <ChatMessage sender="rhizome">
        Found it — verify.ts assumes merchant is always present. Updating the null check.
      </ChatMessage>
    </div>
  ),
};

export const Input: Story = {
  name: "Chat Input",
  render: () => <ChatInput orbSrc={orbs.user} placeholder="What's the move, Noah?" />,
};

export const Chip: Story = {
  name: "File Chip",
  render: () => <FileChip path="src/ingest/verify.ts" />,
};

export const Snippet: Story = {
  name: "Code Snippet",
  render: () => (
    <div className="w-90">
      <CodeSnippet lines={DIFF} />
    </div>
  ),
};

export const ToolCall: Story = {
  name: "Tool Call Block",
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="w-90">
        <ToolCallBlock
          title="⚙ Run: bun test ingest"
          status="success"
          statusLabel="passed"
          lines={LOG}
        />
      </div>
      <ToolCallBlock
        variant="compact"
        title="Run: bun test ingest"
        status="success"
        statusLabel="passed"
        lines={LOG}
      />
      <div className="w-90">
        <ToolCallBlock
          title="⚙ Run: bun run db:migrate"
          status="error"
          statusLabel="error"
          lines={[
            { tone: "error", text: "✗ migrate.ts — relation already exists" },
            { tone: "muted", text: "0 applied · 1 failed · 120ms" },
          ]}
        />
      </div>
    </div>
  ),
};

/**
 * The whole stream. Its children inherit the sidebar's content polarity in either theme;
 * the composer re-enters control. No child needs to know the system preference.
 */
export const Sidebar: Story = {
  name: "Agent Sidebar",
  render: () => (
    <div className="h-[575px]">
      <AgentSidebar
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
    </div>
  ),
};
