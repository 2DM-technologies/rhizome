import type { Decorator, Preview } from "@storybook/react-vite";
import React from "react";

import "../src/styles/index.css";

/**
 * Theme and tier are independent: theme defaults to the system; tier selects control or
 * content. Exercise all four combinations to catch hard-coded colors and nested controls
 * that accidentally inherit content polarity. These overrides are preview-only.
 */
const withTier: Decorator = (Story, context) => {
  const { tier = "control", theme = "system" } = context.globals as {
    tier?: "control" | "content";
    theme?: "system" | "light" | "dark";
  };
  return (
    <div
      data-tier={tier}
      data-theme={theme === "system" ? undefined : theme}
      className="bg-canvas text-primary font-sans"
      style={{ padding: 32, minHeight: "100vh", boxSizing: "border-box" }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTier],
  globalTypes: {
    theme: {
      description: "System theme (preview override)",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "system", title: "System" },
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
    tier: {
      description: "Polarity tier the story renders in",
      toolbar: {
        title: "Tier",
        icon: "contrast",
        items: [
          { value: "control", title: "Control — system polarity" },
          { value: "content", title: "Content — opposite polarity" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { tier: "control", theme: "system" },
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "todo" },
  },
};

export default preview;
