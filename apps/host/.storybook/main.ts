import type { StorybookConfig } from "@storybook/react-vite";

import { HOST_CSS_TARGET } from "../vite.config.ts";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  // Storybook replaces Vite's build defaults; retain native per-tier light-dark() here too.
  viteFinal: (config) => ({
    ...config,
    build: { ...config.build, cssTarget: HOST_CSS_TARGET },
  }),
};

export default config;
