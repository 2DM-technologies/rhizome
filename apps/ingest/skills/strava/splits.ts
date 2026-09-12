import type { FitnessActivityProperties } from "@rnet/types";
import { PARSER_BUDGETS, type OriginalActivity, type DistanceSample } from "./contracts.ts";

export const MILE_METERS = 1_609.344;

/** Interpolate the first crossing of each mile; stationary time stays in the following split. */
export function calculateMileSplits(
  original: OriginalActivity,
): NonNullable<FitnessActivityProperties["splits"]> {
  const samples = original.samples;
  validateDistanceSamples(samples);
  if (samples.length < 2) return [];
  const last = samples.at(-1)!;
  if (original.distanceM !== undefined) {
    const tolerance = Math.max(1, original.distanceM * 0.001);
    if (last.distanceM > original.distanceM + tolerance)
      throw new Error("Original sample distance exceeds the recorded total");
    if (last.distanceM < original.distanceM - tolerance) return [];
  }
  if (original.elapsedS !== undefined) {
    if (last.elapsedS > original.elapsedS + 2)
      throw new Error("Original sample elapsed time exceeds the recorded total");
    if (last.elapsedS < original.elapsedS - 2) return [];
  }
  if (original.timerS !== undefined && last.elapsedS < original.timerS - 2) return [];
  // Missing initial distance evidence cannot reconstruct the first mile faithfully.
  if (samples[0]!.distanceM !== 0 || samples[0]!.elapsedS > 2) return [];
  const total = samples.at(-1)!.distanceM;
  if (total === 0) return [];
  if (Math.ceil(total / MILE_METERS) > PARSER_BUDGETS.splits)
    throw new Error("Original exceeds the split count limit");
  const timer = samples.every((sample) => sample.timerS !== undefined);
  if (
    timer &&
    samples.some(
      (sample, index) =>
        !Number.isFinite(sample.timerS) ||
        sample.timerS! < 0 ||
        (index > 0 && sample.timerS! < samples[index - 1]!.timerS!),
    )
  )
    throw new Error("Original contains inconsistent timer samples");
  const duration = (index: number) => (timer ? samples[index]!.timerS! : samples[index]!.elapsedS);
  const splits: NonNullable<FitnessActivityProperties["splits"]> = [];
  let previousDistance = 0,
    previousTime = duration(0),
    cursor = 1;
  for (let boundary = MILE_METERS; previousDistance < total; boundary += MILE_METERS) {
    const target = Math.min(boundary, total);
    while (cursor < samples.length - 1 && samples[cursor]!.distanceM < target) cursor++;
    const before = samples[cursor - 1]!,
      after = samples[cursor]!;
    const fraction = (target - before.distanceM) / (after.distanceM - before.distanceM);
    const time =
      target === total
        ? duration(samples.length - 1)
        : duration(cursor - 1) + fraction * (duration(cursor) - duration(cursor - 1));
    if (!Number.isFinite(time) || time < previousTime)
      throw new Error("Original cannot support a valid split boundary");
    splits.push({
      index: splits.length + 1,
      target_distance_m: MILE_METERS,
      distance_m: round(target - previousDistance),
      duration_s: round(time - previousTime),
      timing_basis: timer ? "timer" : "elapsed",
      distance_basis: original.distanceBasis,
      method: "linear_interpolation",
      provenance: original.provenance,
    });
    previousDistance = target;
    previousTime = time;
  }
  return splits;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function validateDistanceSamples(samples: DistanceSample[]): void {
  for (const [index, sample] of samples.entries()) {
    if (![sample.distanceM, sample.elapsedS].every((value) => Number.isFinite(value) && value >= 0))
      throw new Error("Original contains invalid distance/time samples");
    const previous = samples[index - 1];
    if (
      previous &&
      (sample.distanceM < previous.distanceM ||
        sample.elapsedS < previous.elapsedS ||
        (sample.distanceM > previous.distanceM && sample.elapsedS === previous.elapsedS))
    )
      throw new Error("Original contains inconsistent distance/time samples");
  }
}
