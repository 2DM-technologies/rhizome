import { matchPath } from "react-router";

/**
 * A surface is anything the shell can focus and the dock can list. Host views and dMachines
 * are the same kind of thing here — both are windows that stay alive while backgrounded — so
 * they share one registry, one geometry, and one focus mechanism.
 */
export type Surface =
  | { readonly kind: "import" }
  | { readonly kind: "vibes" }
  | { readonly kind: "vibe"; readonly uuid: string }
  | { readonly kind: "object"; readonly uuid: string }
  | { readonly kind: "dmachine"; readonly name: string };

/** Stable identity for the open set, the dock, and React keys. */
export type SurfaceId = string;

export function surfaceId(surface: Surface): SurfaceId {
  switch (surface.kind) {
    case "import":
      return "import";
    case "vibes":
      return "vibes";
    case "vibe":
      return `vibe:${surface.uuid}`;
    case "object":
      return `object:${surface.uuid}`;
    case "dmachine":
      return `m:${surface.name}`;
  }
}

export function pathOf(surface: Surface): string {
  switch (surface.kind) {
    case "import":
      return "/imports";
    case "vibes":
      return "/vibes";
    case "vibe":
      return `/vibes/${surface.uuid}`;
    case "object":
      return `/objects/${surface.uuid}`;
    case "dmachine":
      return `/m/${surface.name}`;
  }
}

/**
 * The URL is the source of truth for focus, so this is the only parser. Patterns live beside
 * `pathOf` deliberately: a route added on one side and forgotten on the other is the bug this
 * arrangement exists to prevent.
 */
const PATTERNS: readonly {
  pattern: string;
  surface: (params: Record<string, string>) => Surface;
}[] = [
  { pattern: "/imports", surface: () => ({ kind: "import" }) },
  { pattern: "/vibes", surface: () => ({ kind: "vibes" }) },
  { pattern: "/vibes/:uuid", surface: (p) => ({ kind: "vibe", uuid: p.uuid ?? "" }) },
  { pattern: "/objects/:uuid", surface: (p) => ({ kind: "object", uuid: p.uuid ?? "" }) },
  { pattern: "/m/:name", surface: (p) => ({ kind: "dmachine", name: p.name ?? "" }) },
];

/** The focused surface for a pathname, or null for the bare desktop. */
export function surfaceFromPath(pathname: string): Surface | null {
  for (const { pattern, surface } of PATTERNS) {
    const match = matchPath(pattern, pathname);
    if (match) return surface(match.params as Record<string, string>);
  }
  return null;
}

/** How a focused surface is presented. Standard is the default; maximized fills its work area. */
export type ViewMode = "standard" | "maximized";

export const MODE_PARAM = "mode";

export function viewModeOf(search: string): ViewMode {
  return new URLSearchParams(search).get(MODE_PARAM) === "maximized" ? "maximized" : "standard";
}

/**
 * The location for a surface at a view mode. Maximized is a search param rather than a path so
 * it is deep-linkable, and callers navigate to it with `replace` so toggling never costs a back
 * press to unwind.
 */
export function locationOf(surface: Surface, mode: ViewMode = "standard"): string {
  const path = pathOf(surface);
  return mode === "maximized" ? `${path}?${MODE_PARAM}=maximized` : path;
}

/** A stable, human-readable label without copying server-owned titles into shell state. */
export function labelOf(
  surface: Surface,
  vibeTitles: ReadonlyMap<string, string> = new Map(),
): string {
  switch (surface.kind) {
    case "import":
      return "Import transactions";
    case "vibes":
      return "Vibes";
    case "vibe":
      return vibeTitles.get(surface.uuid) ?? `Vibe …${surface.uuid.slice(-6)}`;
    case "object":
      return `Object …${surface.uuid.slice(-6)}`;
    case "dmachine":
      return surface.name;
  }
}
