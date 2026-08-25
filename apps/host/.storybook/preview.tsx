import type { Decorator, Preview } from "@storybook/react-vite";
import React from "react";

import "../src/styles/index.css";

/**
 * Every story renders inside a tier. The toolbar switch is not a light/dark theme
 * preference — it is the polarity inversion described in `impl/concepts/sandboxing.md` §5,
 * and flipping it is how you check that a component reads its tier instead of hard-coding
 * one. A component that looks correct in only one position is a component with a literal
 * colour in it.
 */
const withTier: Decorator = (Story, context) => {
  const tier = (context.globals as { tier?: "light" | "dark" }).tier ?? "light";
  return (
    <div
      data-tier={tier}
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
    tier: {
      description: "Polarity tier the story renders in",
      toolbar: {
        title: "Tier",
        icon: "contrast",
        items: [
          { value: "light", title: "Light — control tier" },
          { value: "dark", title: "Dark — content tier" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { tier: "light" },
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "todo" },
  },
};

export default preview;
