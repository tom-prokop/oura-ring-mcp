/**
 * Structured (machine-readable) output for the most-used data tools.
 *
 * Each tool keeps its human-readable text in `content` and additionally
 * returns `structuredContent` matching the `outputSchema` declared here.
 * Payloads are compact summaries (no 5-minute series), so they stay small
 * enough for chat clients.
 */
import { z } from "zod";
import type {
  SleepSession,
  DailySleep,
  DailyReadiness,
  DailyActivity,
  HeartRate,
} from "../client.js";

const num = z.number().nullable();
const range = {
  start_date: z.string().describe("First day queried (YYYY-MM-DD)"),
  end_date: z.string().describe("Last day queried (YYYY-MM-DD)"),
};

// ─────────────────────────────────────────────────────────────
// Sleep
// ─────────────────────────────────────────────────────────────

export const sleepOutputSchema = {
  ...range,
  sessions: z
    .array(
      z.object({
        day: z.string(),
        type: z.string().nullable(),
        bedtime_start: z.string(),
        bedtime_end: z.string(),
        sleep_score: num,
        total_sleep_seconds: num,
        time_in_bed_seconds: num,
        deep_sleep_seconds: num,
        rem_sleep_seconds: num,
        light_sleep_seconds: num,
        awake_seconds: num,
        efficiency: num,
        latency_seconds: num,
        average_heart_rate: num,
        lowest_heart_rate: num,
        average_hrv: num,
        average_breath: num,
      })
    )
    .describe("Sleep sessions (from /sleep), each with that day's sleep score"),
  daily_scores: z
    .array(z.object({ day: z.string(), score: num }))
    .describe("Daily sleep scores (from /daily_sleep)"),
};

const n = (v: number | null | undefined): number | null => (typeof v === "number" ? v : null);

export function sleepStructured(
  startDate: string,
  endDate: string,
  sessions: SleepSession[],
  scores: DailySleep[]
) {
  const scoreByDay = new Map(scores.map((s) => [s.day, s.score]));
  return {
    start_date: startDate,
    end_date: endDate,
    sessions: sessions.map((s) => ({
      day: s.day,
      type: (s.type as string | null | undefined) ?? null,
      bedtime_start: s.bedtime_start,
      bedtime_end: s.bedtime_end,
      sleep_score: n(scoreByDay.get(s.day)),
      total_sleep_seconds: n(s.total_sleep_duration),
      time_in_bed_seconds: n(s.time_in_bed),
      deep_sleep_seconds: n(s.deep_sleep_duration),
      rem_sleep_seconds: n(s.rem_sleep_duration),
      light_sleep_seconds: n(s.light_sleep_duration),
      awake_seconds: n(s.awake_time),
      efficiency: n(s.efficiency),
      latency_seconds: n(s.latency),
      average_heart_rate: n(s.average_heart_rate),
      lowest_heart_rate: n(s.lowest_heart_rate),
      average_hrv: n(s.average_hrv),
      average_breath: n(s.average_breath),
    })),
    daily_scores: scores.map((s) => ({ day: s.day, score: n(s.score) })),
  };
}

// ─────────────────────────────────────────────────────────────
// Readiness
// ─────────────────────────────────────────────────────────────

export const readinessOutputSchema = {
  ...range,
  days: z.array(
    z.object({
      day: z.string(),
      score: num,
      temperature_deviation: num,
      temperature_trend_deviation: num,
      contributors: z.record(z.string(), num),
    })
  ),
};

export function readinessStructured(startDate: string, endDate: string, days: DailyReadiness[]) {
  return {
    start_date: startDate,
    end_date: endDate,
    days: days.map((d) => ({
      day: d.day,
      score: n(d.score),
      temperature_deviation: n(d.temperature_deviation),
      temperature_trend_deviation: n(d.temperature_trend_deviation),
      contributors: Object.fromEntries(
        Object.entries(d.contributors ?? {}).map(([k, v]) => [k, n(v as number | null)])
      ),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Activity
// ─────────────────────────────────────────────────────────────

export const activityOutputSchema = {
  ...range,
  days: z.array(
    z.object({
      day: z.string(),
      score: num,
      steps: num,
      total_calories: num,
      active_calories: num,
      equivalent_walking_distance_m: num,
      high_activity_seconds: num,
      medium_activity_seconds: num,
      low_activity_seconds: num,
      sedentary_seconds: num,
      resting_seconds: num,
      non_wear_seconds: num,
    })
  ),
};

export function activityStructured(startDate: string, endDate: string, days: DailyActivity[]) {
  return {
    start_date: startDate,
    end_date: endDate,
    days: days.map((d) => ({
      day: d.day,
      score: n(d.score),
      steps: n(d.steps),
      total_calories: n(d.total_calories),
      active_calories: n(d.active_calories),
      equivalent_walking_distance_m: n(d.equivalent_walking_distance),
      high_activity_seconds: n(d.high_activity_time),
      medium_activity_seconds: n(d.medium_activity_time),
      low_activity_seconds: n(d.low_activity_time),
      sedentary_seconds: n(d.sedentary_time),
      resting_seconds: n(d.resting_time),
      non_wear_seconds: n(d.non_wear_time),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Heart rate (aggregates only — raw series can be thousands of points)
// ─────────────────────────────────────────────────────────────

const hrStats = z.object({
  count: z.number(),
  average_bpm: num,
  min_bpm: num,
  max_bpm: num,
});

export const heartRateOutputSchema = {
  ...range,
  overall: hrStats,
  by_source: z.record(z.string(), hrStats).describe("Stats per source (awake, rest, sleep, workout, ...)"),
  by_day: z.record(z.string(), hrStats).describe("Stats per UTC day (YYYY-MM-DD)"),
};

function stats(bpms: number[]) {
  if (bpms.length === 0) return { count: 0, average_bpm: null, min_bpm: null, max_bpm: null };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const b of bpms) {
    sum += b;
    if (b < min) min = b;
    if (b > max) max = b;
  }
  return { count: bpms.length, average_bpm: Math.round(sum / bpms.length), min_bpm: min, max_bpm: max };
}

function groupStats(readings: HeartRate[], key: (r: HeartRate) => string) {
  const groups: Record<string, number[]> = {};
  for (const r of readings) (groups[key(r)] ??= []).push(r.bpm);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, stats(v)]));
}

export function heartRateStructured(startDate: string, endDate: string, readings: HeartRate[]) {
  return {
    start_date: startDate,
    end_date: endDate,
    overall: stats(readings.map((r) => r.bpm)),
    by_source: groupStats(readings, (r) => String(r.source)),
    by_day: groupStats(readings, (r) => r.timestamp.slice(0, 10)),
  };
}
