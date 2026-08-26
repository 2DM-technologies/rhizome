import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Session for the development auth mode. The store recognises three bearer strings and seeds
 * the matching rows; there is no `/me` endpoint yet, so the identities are mirrored here.
 *
 * This whole file is replaced at M7 by Better Auth. `useSession()` deliberately returns that
 * hook's shape so the swap is an import change rather than a rewrite of every caller.
 */

export interface Identity {
  /** Canonical and stable. Key off this, never the handle. */
  readonly id: string;
  /** Display only — a rename must not break a reference. */
  readonly handle: string;
  readonly name: string;
}

export type DevToken = "dev:user" | "dev:user:other";

/** Mirrors the uuids seeded by `apps/server/src/db/seedDb.ts`. */
export const DEV_IDENTITIES: Readonly<Record<DevToken, Identity>> = {
  "dev:user": {
    id: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
    handle: "noah",
    name: "Development User",
  },
  "dev:user:other": {
    id: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b49",
    handle: "other",
    name: "Other Development User",
  },
};

interface SessionState {
  token: DevToken;
  /** Switching identities is how grant and ownership behaviour gets exercised by hand. */
  signInAs: (token: DevToken) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: "dev:user",
      signInAs: (token) => set({ token }),
    }),
    { name: "rhizome.session", storage: createJSONStorage(() => localStorage) },
  ),
);

/**
 * The bearer, read outside React by the API client. A store rather than a provider precisely
 * so this is possible without a mutable module-level token.
 */
export function bearerToken(): string {
  return useSessionStore.getState().token;
}

/** Shaped like Better Auth's `useSession`. */
export function useSession(): { data: { user: Identity } | null; isPending: boolean } {
  const token = useSessionStore((state) => state.token);
  return { data: { user: DEV_IDENTITIES[token] }, isPending: false };
}
