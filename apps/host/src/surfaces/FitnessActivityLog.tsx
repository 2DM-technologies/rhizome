import { useMemo, useState } from "react";
import type { FitnessActivityProperties, MediaObject } from "@rnet/types";

import { uuidOf } from "../api/uris.ts";
import { pathOf } from "../shell/surfaces.ts";
import {
  activityDate,
  activityDuration,
  activityFacts,
  distanceLabel,
  durationLabel,
  isSourceRace,
  measurement,
  newestActivities,
  paceLabel,
  runPaceHistory,
  timingLabels,
  uniqueActivities,
  weeklyDistance,
  type DistanceUnit,
  type TimingBasis,
} from "./fitnessactivity.ts";

interface Props {
  objects: MediaObject[];
  openObject: (object: MediaObject) => void;
  removeObject?: (object: MediaObject) => void;
  removePending?: boolean;
}
const control = "rounded-sm border border-hairline bg-canvas px-3 py-2 text-caption text-primary";

export function FitnessActivityLog({ objects, ...actions }: Props) {
  const [unit, setUnit] = useState<DistanceUnit>("mi");
  const [basis, setBasis] = useState<TimingBasis>("elapsed");
  const [filter, setFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(50);
  const visible = useMemo(
    () =>
      objects.filter(
        (object) =>
          filter === "all" ||
          (filter === "races" ? isSourceRace(object) : activityFacts(object).sport === "run"),
      ),
    [objects, filter],
  );
  const rows = useMemo(() => newestActivities(visible), [visible]);
  const unique = useMemo(() => uniqueActivities(visible), [visible]);
  const distances = unique
    .map((object) => measurement(activityFacts(object).distance_m))
    .filter((value) => value !== undefined);
  const total = distances.reduce((a, b) => a + b, 0);
  return (
    <div className="fitness-activity-log" aria-label="Fitness activity log">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-heading text-primary">Activity log</h2>
          <p className="mt-1 text-caption text-tertiary">Your recorded sessions, newest first.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-caption text-secondary">
            Activities
            <select
              className={control}
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setVisibleLimit(50);
              }}
            >
              <option value="all">All activities</option>
              <option value="runs">Runs</option>
              <option value="races">Source-labeled races</option>
            </select>
          </label>
          <label className="grid gap-1 text-caption text-secondary">
            Distance
            <select
              className={control}
              value={unit}
              onChange={(event) => setUnit(event.target.value as DistanceUnit)}
            >
              <option value="mi">Miles</option>
              <option value="km">Kilometers</option>
            </select>
          </label>
          <label className="grid gap-1 text-caption text-secondary">
            Timing basis
            <select
              className={control}
              value={basis}
              onChange={(event) => setBasis(event.target.value as TimingBasis)}
            >
              <option value="elapsed">Elapsed · includes pauses</option>
              <option value="timer">Timer · device running</option>
              <option value="moving">Moving · source classified</option>
            </select>
          </label>
        </div>
      </header>
      <div className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y border-hairline py-4">
        <p className="text-heading text-primary">
          {unique.length}{" "}
          <span className="text-caption text-secondary">
            {unique.length === 1 ? "activity" : "activities"}
          </span>
        </p>
        <p className="text-heading text-primary">
          {distances.length ? distanceLabel(total, unit) : "Distance unavailable"}{" "}
          <span className="text-caption text-secondary">recorded distance</span>
        </p>
        <p className="text-caption text-tertiary">
          {distances.length} of {unique.length} have distance · totals count each activity once
        </p>
      </div>
      {unique.length ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <WeeklyDistance objects={unique} unit={unit} />
          <PaceHistory objects={unique} unit={unit} basis={basis} />
        </div>
      ) : (
        <p className="py-6 text-body text-secondary">No activities match this filter.</p>
      )}
      <ul aria-label="Activity history" className="divide-y divide-hairline">
        {rows.slice(0, visibleLimit).map(({ object, position, date }) => (
          <ActivityRow
            key={`${object.uri}:${position}`}
            object={object}
            date={date}
            unit={unit}
            basis={basis}
            {...actions}
          />
        ))}
      </ul>
      {rows.length > visibleLimit ? (
        <button
          type="button"
          className={`${control} mt-4`}
          onClick={() => setVisibleLimit((limit) => limit + 50)}
        >
          Show more activities ({visibleLimit} of {rows.length} shown)
        </button>
      ) : null}
    </div>
  );
}

function WeeklyDistance({ objects, unit }: { objects: MediaObject[]; unit: DistanceUnit }) {
  const weeks = weeklyDistance(objects);
  const maximum = Math.max(...weeks.map((week) => week.meters), 1);
  return (
    <section
      aria-label="Weekly recorded distance"
      className="min-w-0 rounded-sm border border-hairline p-4"
    >
      <h3 className="text-label text-primary">Weekly distance</h3>
      <p className="mt-1 text-caption text-tertiary">
        Eight weeks through the latest activity · weeks start Monday
      </p>
      {weeks.length ? (
        <ol className="fitness-week-chart mt-4">
          {weeks.map((week, index) => (
            <li
              key={week.key}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
              aria-label={`Week of ${week.key}: ${week.activities && !week.measured ? "distance unavailable" : distanceLabel(week.meters, unit)}, ${week.activities} activities, ${week.measured} with distance`}
            >
              <span className="text-caption text-secondary">
                {week.measured ? (week.meters / (unit === "mi" ? 1609.344 : 1000)).toFixed(1) : "—"}
              </span>
              <span
                className="fitness-week-bar"
                style={{ height: `${(week.meters / maximum) * 88}px` }}
              />
              <span
                className={`text-caption text-tertiary ${index % 2 ? "invisible sm:visible" : ""}`}
              >
                {week.key.slice(5).replace("-", "/")}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-caption text-tertiary">Dated activity history unavailable.</p>
      )}
      <p className="mt-3 text-caption text-tertiary">
        Missing distances are excluded. Dates retain the source time zone.
      </p>
    </section>
  );
}

function PaceHistory({
  objects,
  unit,
  basis,
}: {
  objects: MediaObject[];
  unit: DistanceUnit;
  basis: TimingBasis;
}) {
  const points = runPaceHistory(objects, basis, unit);
  const minimum = Math.min(...points.map((point) => point.pace));
  const maximum = Math.max(...points.map((point) => point.pace));
  const x = (index: number) =>
    points.length === 1 ? 160 : 12 + (index / (points.length - 1)) * 296;
  const y = (pace: number) =>
    maximum === minimum ? 60 : 12 + ((pace - minimum) / (maximum - minimum)) * 96;
  return (
    <section
      aria-label="Run pace history"
      className="min-w-0 rounded-sm border border-hairline p-4"
    >
      <h3 className="text-label text-primary">Run pace · {timingLabels[basis].toLowerCase()}</h3>
      <p className="mt-1 text-caption text-tertiary">
        Up to 24 recent runs with this timing basis · faster toward the top
      </p>
      {points.length ? (
        <>
          <svg
            role="img"
            aria-label={`${timingLabels[basis]} pace history, ${points.length} runs; ${durationLabel(minimum)} to ${durationLabel(maximum)} per ${unit}`}
            viewBox="0 0 320 120"
            className="mt-4 h-32 w-full text-accent"
          >
            <polyline
              points={points.map((point, index) => `${x(index)},${y(point.pace)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            {points.map((point, index) => (
              <circle
                key={point.object.uri}
                cx={x(index)}
                cy={y(point.pace)}
                r="3"
                fill="currentColor"
              >
                <title>{`${point.date.label}: ${durationLabel(point.pace)} / ${unit}`}</title>
              </circle>
            ))}
          </svg>
          <p className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption text-secondary">
            <span>{points[0]!.date.key.slice(0, 10)}</span>
            <span>
              {durationLabel(minimum)}–{durationLabel(maximum)} / {unit}
            </span>
            <span>{points.at(-1)!.date.key.slice(0, 10)}</span>
          </p>
        </>
      ) : (
        <p className="min-h-32 py-6 text-caption text-tertiary">
          No runs have both distance and {basis} time for this chart.
        </p>
      )}
      <p className="mt-3 text-caption text-tertiary">
        Average pace per run; terrain, effort, and pauses can differ.
      </p>
    </section>
  );
}

function ActivityRow({
  object,
  date,
  unit,
  basis,
  openObject,
  removeObject,
  removePending,
}: Omit<Props, "objects"> & {
  object: MediaObject;
  date: ReturnType<typeof activityDate>;
  unit: DistanceUnit;
  basis: TimingBasis;
}) {
  const [showSegments, setShowSegments] = useState(false);
  const facts = activityFacts(object);
  const laps = Array.isArray(facts.laps) ? facts.laps : [];
  const splits = Array.isArray(facts.splits) ? facts.splits : [];
  const title =
    typeof facts.title === "string" && facts.title.trim()
      ? facts.title
      : typeof facts.sport === "string"
        ? facts.sport
        : "Activity";
  return (
    <li data-activity-object={object.uri} className="py-5">
      <article className="min-w-0" aria-label={title}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-label text-primary">{title}</h3>
              {isSourceRace(object) ? (
                <span className="rounded-pill bg-surface px-2 py-1 text-caption text-secondary">
                  Race · source label
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-caption text-tertiary">
              {date ? (
                <>
                  <time dateTime={date.raw}>{date.label}</time> · {date.zone}
                </>
              ) : (
                "Date unavailable"
              )}{" "}
              · {typeof facts.sport === "string" ? facts.sport : "Sport unavailable"}
            </p>
          </div>
          <div className="flex gap-3 text-caption">
            <a
              className="text-link"
              aria-label={`Open object ${object.uri}`}
              href={pathOf({ kind: "object", uuid: uuidOf(object.uri) })}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                openObject(object);
              }}
            >
              Open
            </a>
            {removeObject && object.source.ingest.method === "authored" ? (
              <button
                type="button"
                className="text-link"
                aria-label={`Remove ${object.uri} from Vibe`}
                disabled={removePending}
                onClick={() => removeObject(object)}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-caption sm:grid-cols-4">
          <Metric label="Distance" value={distanceLabel(facts.distance_m, unit)} />
          <Metric
            label={`${timingLabels[basis]} time`}
            value={durationLabel(activityDuration(object, basis))}
          />
          <Metric
            label={`${timingLabels[basis]} pace`}
            value={paceLabel(facts.distance_m, activityDuration(object, basis), unit)}
          />
          <Metric
            label="Elevation gain"
            value={
              measurement(facts.elevation_gain_m) === undefined
                ? "Unavailable"
                : `${facts.elevation_gain_m} m`
            }
          />
        </dl>
        <OfficialResult object={object} />
        {splits.length || laps.length ? (
          <details
            className="mt-4 text-caption"
            onToggle={(event) => setShowSegments(event.currentTarget.open)}
          >
            <summary className="w-fit cursor-pointer text-accent">
              {splits.length} calculated splits · {laps.length} recorded laps
            </summary>
            {showSegments &&
              (splits.length ? (
                <SegmentTable title="Calculated distance splits" records={splits} unit={unit} />
              ) : (
                <p className="mt-3 text-tertiary">Calculated splits unavailable.</p>
              ))}
            {showSegments && laps.length ? (
              <SegmentTable title="Recorded laps" records={laps} unit={unit} />
            ) : null}
          </details>
        ) : (
          <p className="mt-4 text-caption text-tertiary">
            Laps and individual splits unavailable in this record.
          </p>
        )}
      </article>
    </li>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tertiary">{label}</dt>
      <dd className="mt-1 font-mono text-primary">{value}</dd>
    </div>
  );
}
function OfficialResult({ object }: { object: MediaObject }) {
  const facts = object.user?.properties;
  if (!facts) return null;
  const chip = measurement(facts.official_chip_time_s),
    gun = measurement(facts.official_gun_time_s);
  if (chip === undefined && gun === undefined) return null;
  return (
    <aside
      className="mt-4 rounded-sm bg-surface px-3 py-2 text-caption text-secondary"
      aria-label="Owner-entered official result"
    >
      <p>
        Official result · owner entered
        {typeof facts.event_name === "string" ? ` · ${facts.event_name}` : ""}
      </p>
      <p className="mt-1">
        {chip !== undefined ? `Chip time ${durationLabel(chip)}` : ""}
        {chip !== undefined && gun !== undefined ? " · " : ""}
        {gun !== undefined ? `Gun time ${durationLabel(gun)}` : ""}
      </p>
    </aside>
  );
}
function SegmentTable({
  title,
  records,
  unit,
}: {
  title: string;
  records:
    | NonNullable<FitnessActivityProperties["laps"]>
    | NonNullable<FitnessActivityProperties["splits"]>;
  unit: DistanceUnit;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-caption">
        <caption className="mb-2 text-left text-label text-secondary">{title}</caption>
        <thead className="text-tertiary">
          <tr>
            <th scope="col" className="p-2">
              Segment
            </th>
            <th scope="col" className="p-2">
              Distance
            </th>
            <th scope="col" className="p-2">
              Time
            </th>
            <th scope="col" className="p-2">
              Pace
            </th>
            <th scope="col" className="p-2">
              Evidence
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={index} className="border-t border-hairline">
              <th scope="row" className="p-2 font-normal">
                {record.index}
                {"target_distance_m" in record && record.distance_m < record.target_distance_m
                  ? " · partial"
                  : ""}
              </th>
              <td className="p-2 font-mono">{distanceLabel(record.distance_m, unit)}</td>
              <td className="p-2 font-mono">
                {durationLabel(record.duration_s)}{" "}
                <span className="font-sans text-tertiary">{record.timing_basis}</span>
              </td>
              <td className="p-2 font-mono">
                {paceLabel(record.distance_m, record.duration_s, unit)}
              </td>
              <td className="max-w-80 break-words p-2 text-tertiary">
                {record.distance_basis ? `${record.distance_basis} distance · ` : ""}
                {record.provenance}
                {"method" in record ? ` · ${record.method}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
