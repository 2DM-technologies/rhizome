import { Activity, memo, useEffect, useMemo, useState } from "react";

import developmentUserProfile from "../assets/profile/development-user.jpg";
import { useDashboardStats, useVibes } from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import { newestVibesFirst } from "../vibeRecency.ts";
import { DesktopVibeCard } from "./DesktopVibeCard.tsx";

const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const integer = new Intl.NumberFormat();

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <strong className="truncate text-[18px] font-normal leading-tight text-primary">
        {value === undefined ? "—" : integer.format(value)}
      </strong>
      <span className="text-[18px] leading-tight text-primary">{label}</span>
    </div>
  );
}

/** Keep a visited desktop's DOM and scroll state, with effects paused behind a window. */
export function DesktopHome({ visible }: { visible: boolean }) {
  const [visited, setVisited] = useState(visible);
  if (visible && !visited) setVisited(true);
  if (!visible && !visited) return null;

  return (
    <Activity mode={visible ? "visible" : "hidden"}>
      <div data-desktop-layer>
        <DesktopHomeContent />
      </div>
    </Activity>
  );
}

/** Shell navigation and launcher typing don't rebuild these panels; query updates stay live. */
const DesktopHomeContent = memo(function DesktopHomeContent() {
  const session = useSession();
  const stats = useDashboardStats();
  const vibes = useVibes();
  const now = useMinuteClock();
  const sortedVibes = useMemo(() => [...(vibes.data ?? [])].sort(newestVibesFirst), [vibes.data]);
  const accountCreatedAt = stats.data?.account_created_at;

  return (
    <main
      data-desktop-home
      aria-label="Home"
      className="absolute inset-x-6 top-6 bottom-28 overflow-y-auto sm:inset-x-12 lg:overflow-hidden"
    >
      <div className="grid min-h-full w-full grid-cols-1 gap-5 xl:h-full xl:min-h-0 xl:grid-cols-[35%_62%] xl:justify-between xl:gap-0">
        <section className="flex min-h-80 flex-col rounded-lg border border-dashed border-neutral-border bg-home-panel p-7 xl:min-h-0 2xl:p-[60px]">
          <div className="flex items-center gap-4">
            <img
              src={developmentUserProfile}
              alt=""
              aria-hidden
              className="size-12 rounded-full object-cover [image-rendering:auto]"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[20px] font-medium leading-tight tracking-[-0.2px] text-primary">
                {session.data?.user.name ?? "Rhizome"}
              </h1>
              {session.data?.user.handle ? (
                <p className="truncate text-caption text-primary">@{session.data.user.handle}</p>
              ) : null}
              <p className="mt-2 text-[11px] leading-tight text-secondary">
                {accountCreatedAt
                  ? `Member since ${monthYear.format(new Date(accountCreatedAt))}`
                  : "Member since —"}
              </p>
            </div>
          </div>

          <div className="mt-8 flex min-h-56 flex-1 flex-col justify-center bg-home-stat px-10 py-12 2xl:px-12">
            {stats.isError ? (
              <p role="status" className="mb-3 text-caption text-secondary">
                Account totals are temporarily unavailable.
              </p>
            ) : null}
            <p className="mb-5 text-[18px] leading-tight text-primary">Your Rhizome at a glance.</p>
            <div className="flex flex-col gap-0.5">
              <Stat label="Objects" value={stats.data?.objects} />
              <Stat label="Elements" value={stats.data?.elements} />
              <Stat label="Tokens used" value={stats.data?.tokens.total} />
            </div>
          </div>
        </section>

        <section className="flex min-h-[42rem] flex-col rounded-lg border border-dashed border-neutral-border bg-home-panel p-7 xl:min-h-0 2xl:p-[60px]">
          <h2 className="flex items-center font-serif text-[30px] font-normal leading-none tracking-[-0.35px] text-primary">
            My Vibes
            <span aria-hidden className="ml-1 size-1.5 rounded-full bg-accent" />
          </h2>
          {/* Give outer shadows room inside the scroll clip without shifting the cards. */}
          <div className="-mx-3 -mb-3 mt-3 min-h-0 flex-1 overflow-y-auto p-3 pr-4">
            {vibes.isPending ? (
              <p className="text-body text-tertiary">Loading Vibes…</p>
            ) : vibes.isError ? (
              <p role="status" className="text-body text-secondary">
                Vibes are temporarily unavailable.
              </p>
            ) : sortedVibes.length === 0 ? (
              <p className="text-body text-tertiary">No Vibes yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-x-10 gap-y-4 min-[720px]:grid-cols-2">
                {sortedVibes.map((vibe) => (
                  <DesktopVibeCard key={vibe.uri} vibe={vibe} now={now} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
});
