import { Decoder, Stream } from "@garmin/fitsdk";
import { PARSER_BUDGETS, type OriginalActivity, type DistanceSample } from "./contracts.ts";
import { validateDistanceSamples } from "./splits.ts";

type Message = Record<string, unknown>;

/** Garmin's official scaled decoder, with CRC, single-session, message and sample bounds. */
export function parseFit(bytes: Uint8Array): OriginalActivity {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity())
    throw new Error("FIT original failed header/CRC integrity");
  const headerSize = bytes[0]!;
  const dataSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    4,
    true,
  );
  if (headerSize + dataSize + 2 !== bytes.byteLength)
    throw new Error("FIT original must contain exactly one file");
  let messagesRead = 0;
  const { messages: decoded, errors } = decoder.read({
    mergeHeartRates: false,
    includeUnknownData: false,
    decodeMemoGlobs: false,
    mesgListener() {
      if (++messagesRead > PARSER_BUDGETS.fitMessages)
        throw new Error("FIT message limit exceeded");
    },
  });
  if (errors.length) throw new Error(`FIT decoding failed: ${errors[0]!.message}`);
  const messages = decoded as unknown as Record<string, Message[] | undefined>;
  const sessions = messages.sessionMesgs ?? [];
  if (sessions.length !== 1) throw new Error("FIT original must contain exactly one session");
  const session = sessions[0]!;
  if (session.sport !== "running") throw new Error("FIT original does not describe running");
  const startedAt = date(session.startTime, "FIT session start");
  const startMs = Date.parse(startedAt);
  const distanceM = number(session.totalDistance, "FIT session distance");
  const elapsedS = number(session.totalElapsedTime, "FIT session elapsed time");
  const timerS = number(session.totalTimerTime, "FIT session timer time");
  if (elapsedS !== undefined && timerS !== undefined && timerS > elapsedS + 1)
    throw new Error("FIT session timer exceeds elapsed time");
  const lapMessages = messages.lapMesgs ?? [];
  if (lapMessages.length > PARSER_BUDGETS.laps) throw new Error("FIT exceeds the lap count limit");
  const laps = lapMessages.map((lap, index) => {
    const distance = number(lap.totalDistance, "FIT lap distance");
    const timer = number(lap.totalTimerTime, "FIT lap timer time");
    const elapsed = number(lap.totalElapsedTime, "FIT lap elapsed time");
    const duration = timer ?? elapsed;
    if (distance === undefined && duration === undefined)
      throw new Error("FIT lap has no measurements");
    return {
      index: index + 1,
      ...(distance === undefined
        ? { duration_s: duration! }
        : { distance_m: distance, ...(duration === undefined ? {} : { duration_s: duration }) }),
      timing_basis: timer === undefined ? ("elapsed" as const) : ("timer" as const),
      distance_basis: "recorded" as const,
      provenance:
        timer === undefined
          ? "fit:lap.totalDistance/totalElapsedTime"
          : "fit:lap.totalDistance/totalTimerTime",
    };
  });
  const records = messages.recordMesgs ?? [];
  if (records.length > PARSER_BUDGETS.samples) throw new Error("FIT exceeds its sample limit");
  let missingEvidence = false;
  const samples: DistanceSample[] = [];
  for (const record of records) {
    const distance = number(record.distance, "FIT sample distance");
    if (distance === undefined || record.timestamp === undefined) {
      missingEvidence = true;
      continue;
    }
    const timestamp = date(record.timestamp, "FIT sample timestamp");
    samples.push({ distanceM: distance, elapsedS: (Date.parse(timestamp) - startMs) / 1_000 });
  }
  validateDistanceSamples(samples);
  if (!missingEvidence) applyTimerEvidence(samples, messages.eventMesgs ?? [], startMs, timerS);
  return {
    format: "fit",
    startedAt,
    ...(distanceM === undefined ? {} : { distanceM }),
    ...(elapsedS === undefined ? {} : { elapsedS }),
    ...(timerS === undefined ? {} : { timerS }),
    laps,
    samples: missingEvidence ? [] : samples,
    distanceBasis: "recorded",
    provenance: samples.every((sample) => sample.timerS !== undefined)
      ? "fit:record.distance/timer-events"
      : "fit:record.distance/timestamp",
  };
}

/** Only an ordered start/stop timer stream with matching session total supports timer splits. */
function applyTimerEvidence(
  samples: DistanceSample[],
  messages: Message[],
  startMs: number,
  totalTimer?: number,
): void {
  if (!samples.length || totalTimer === undefined) return;
  const events = messages
    .filter((message) => message.event === "timer")
    .map((message) => ({
      time: (Date.parse(date(message.timestamp, "FIT timer event timestamp")) - startMs) / 1_000,
      type: message.eventType,
    }));
  if (!events.length || events[0]!.type !== "start" || Math.abs(events[0]!.time) > 2) return;
  const intervals: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (const [index, event] of events.entries()) {
    if (index > 0 && event.time < events[index - 1]!.time)
      throw new Error("FIT timer events are out of order");
    if (event.type === "start") {
      if (start !== undefined) return;
      start = event.time;
    } else if (["stop", "stopAll", "stopDisable", "stopDisableAll"].includes(String(event.type))) {
      if (start === undefined || event.time < start) return;
      intervals.push({ start, end: event.time });
      start = undefined;
    } else return;
  }
  if (start !== undefined) intervals.push({ start, end: samples.at(-1)!.elapsedS });
  const timerAt = (time: number) =>
    intervals.reduce(
      (total, interval) => total + Math.max(0, Math.min(time, interval.end) - interval.start),
      0,
    );
  if (Math.abs(timerAt(samples.at(-1)!.elapsedS) - totalTimer) > 2) return;
  for (const sample of samples) sample.timerS = timerAt(sample.elapsedS);
}

function number(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12)
    throw new Error(`${label} is invalid`);
  return value;
}
function date(value: unknown, label: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf()))
    throw new Error(`${label} is missing or invalid`);
  return value.toISOString();
}
