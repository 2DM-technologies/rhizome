import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";

import { createQueryClient } from "./queries/index.ts";
import { ShellLayout } from "./shell/ShellLayout.tsx";

/**
 * Providers and nothing else. There is no route table: every route in this app renders the
 * same persistent shell, and the URL is read for focus rather than dispatched on. `matchPath`
 * in `shell/surfaces.ts` is the only place a path is interpreted.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ShellLayout />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
