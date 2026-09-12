import type { FitnessActivityProperties } from "@rnet/types";

export const STRAVA_PARSER_NAME = "strava-export";
export const STRAVA_PARSER_VERSION = "strava-export@1.0.0";
export const STRAVA_CSV_DIALECT = "strava.activities.english-duplicate-metrics@1";
export const STRAVA_LIMITS = {
  maxCandidates: 10_000,
  maxCaptureBytes: 48 * 1_024 * 1_024,
  maxElementBytes: 1,
  maxTotalElementBytes: 1,
} as const;
export const PARSER_BUDGETS = {
  csvBytes: 16 * 1_024 * 1_024,
  archiveEntries: 50_000,
  expandedBytes: 256 * 1_024 * 1_024,
  originalBytes: 16 * 1_024 * 1_024,
  sourceRows: 50_000,
  samples: 100_000,
  xmlNodes: 1_000_000,
  fitMessages: 150_000,
  laps: 1_000,
  splits: 1_000,
  objectBytes: 64 * 1_024,
  outputBytes: 32 * 1_024 * 1_024,
} as const;

export type DetailStatus =
  "summary_only" | "missing" | "unsupported" | "no_distance_samples" | "laps_only" | "splits";
export interface StravaMetadata {
  activity_type: string;
  detail_status: DetailStatus;
  original_format?: "fit" | "tcx" | "gpx";
  original_summary?: { distance_m?: number; elapsed_time_s?: number; timer_time_s?: number };
  manual?: boolean;
}
export type StravaActivityProperties = FitnessActivityProperties & { strava: StravaMetadata };
export interface ParsedStravaActivity {
  id: string;
  originalPath?: string;
  properties: StravaActivityProperties;
}
export interface ParsedStravaExport {
  dialect: typeof STRAVA_CSV_DIALECT;
  sourceRecordCount: number;
  excludedBySport: Record<string, number>;
  activities: ParsedStravaActivity[];
  inputKind: "csv" | "archive";
}
export interface DistanceSample {
  distanceM: number;
  elapsedS: number;
  timerS?: number;
}
export interface OriginalActivity {
  format: "fit" | "tcx" | "gpx";
  startedAt?: string;
  distanceM?: number;
  elapsedS?: number;
  timerS?: number;
  laps: NonNullable<FitnessActivityProperties["laps"]>;
  samples: DistanceSample[];
  distanceBasis: "recorded" | "gps";
  provenance: string;
}
