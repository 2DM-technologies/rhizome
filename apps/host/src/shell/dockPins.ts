import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useSession } from "../session/session.ts";

interface DockPinsState {
  /** Ordered UUIDs only; titles and orb recipes come from the current Vibe catalog. */
  vibeUuidsByUser: Record<string, string[]>;
  setPinned: (userId: string, uuid: string, pinned: boolean) => void;
}

export const useDockPinsStore = create<DockPinsState>()(
  persist(
    (set) => ({
      vibeUuidsByUser: {},
      setPinned: (userId, uuid, pinned) =>
        set((state) => {
          const previous = state.vibeUuidsByUser[userId] ?? [];
          if (previous.includes(uuid) === pinned) return state;
          return {
            vibeUuidsByUser: {
              ...state.vibeUuidsByUser,
              [userId]: pinned ? [...previous, uuid] : previous.filter((id) => id !== uuid),
            },
          };
        }),
    }),
    {
      name: "rhizome.dock-pins",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ vibeUuidsByUser: state.vibeUuidsByUser }),
    },
  ),
);

const NO_PINS: readonly string[] = [];

export function usePinnedVibeUuids(): readonly string[] {
  const userId = useSession().data?.user.id;
  return useDockPinsStore((state) =>
    userId ? (state.vibeUuidsByUser[userId] ?? NO_PINS) : NO_PINS,
  );
}
