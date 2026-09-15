import type { Surface } from "./surfaces.ts";
import type { Theme } from "../theme.tsx";

export const SHELL_SEARCH_GROUPS = ["Commands", "Vibes"] as const;

export type ShellSearchGroup = (typeof SHELL_SEARCH_GROUPS)[number];

export interface LoadedVibe {
  readonly uuid: string;
  readonly title: string;
}

export type ShellSearchAction =
  | { readonly kind: "theme"; readonly theme: Theme }
  | { readonly kind: "open"; readonly surface: Surface };

export interface ShellSearchResult {
  readonly id: string;
  readonly group: ShellSearchGroup;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly action: ShellSearchAction;
}

const STATIC_COMMANDS: readonly ShellSearchResult[] = [
  {
    id: "command:import",
    group: "Commands",
    label: "Ingest",
    keywords: ["import", "connect", "file", "media", "source", "upload"],
    action: { kind: "open", surface: { kind: "import" } },
  },
  {
    id: "command:open-vibes",
    group: "Commands",
    label: "Open Vibes",
    keywords: ["browse", "collections", "home"],
    action: { kind: "open", surface: { kind: "vibes" } },
  },
];

/**
 * Build the launcher's transient view over already-loaded server state. Vibe titles remain in
 * TanStack Query rather than being copied into Zustand merely so the launcher can display them.
 */
export function searchShell(
  query: string,
  loadedVibes: readonly LoadedVibe[],
  theme: Theme,
): ShellSearchResult[] {
  const nextTheme = theme === "dark" ? "light" : "dark";
  const themeCommand: ShellSearchResult = {
    id: `command:${nextTheme}-mode`,
    group: "Commands",
    label: nextTheme === "dark" ? "Dark Mode" : "Light Mode",
    keywords: ["theme", "appearance", "color", "scheme"],
    action: { kind: "theme", theme: nextTheme },
  };
  const vibeResults = loadedVibes.map((vibe): ShellSearchResult => ({
    id: `vibe:${vibe.uuid}`,
    group: "Vibes",
    label: vibe.title,
    keywords: ["vibe", vibe.uuid],
    action: { kind: "open", surface: { kind: "vibe", uuid: vibe.uuid } },
  }));

  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...STATIC_COMMANDS, themeCommand, ...vibeResults].filter((result) => {
    if (terms.length === 0) return true;
    const searchable = [result.label, ...result.keywords].join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
