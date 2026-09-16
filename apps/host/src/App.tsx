import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { VibeOrbPlayground } from "./orb/VibeOrbPlayground.tsx";
import { createQueryClient } from "./queries/index.ts";
import { ShellLayout } from "./shell/ShellLayout.tsx";

const router = createBrowserRouter([
  { path: "/playgrounds/vibe-orb", element: <VibeOrbPlayground /> },
  { path: "*", element: <ShellLayout /> },
]);

/**
 * Providers and one catch-all route. Every URL renders the same persistent shell, and the URL
 * is read for focus rather than dispatched on. `matchPath` in `shell/surfaces.ts` is the only
 * place a path is interpreted.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
