/**
 * Utilities for formatting Oura data into human-readable strings
 */

/**
 * Convert seconds to a human-readable duration string
 * e.g., 27000 -> "7h 30m"
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Convert seconds to hours with one decimal
 * e.g., 27000 -> 7.5
 */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/**
 * Format a timestamp to a readable time, preserving the original timezone
 * e.g., "2024-01-15T22:30:00-05:00" -> "10:30 PM"
 *
 * Oura returns local wall-clock times with the user's offset, so we read the
 * clock time straight from the string instead of converting to the server's
 * timezone (which would be UTC on most hosts, including Cloudflare Workers).
 */
const ISO_DATETIME_PATTERN =
  /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function formatTime(isoTimestamp: string): string {
  const match = ISO_DATETIME_PATTERN.exec(isoTimestamp);
  if (!match) {
    return "Invalid Date";
  }
  const [, month, day, hourStr, minute] = match;
  const hour = Number(hourStr);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31 || hour > 23 || Number(minute) > 59) {
    return "Invalid Date";
  }
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get a date N days ago in YYYY-MM-DD format
 */
export function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

/**
 * Calculate percentage with one decimal
 */
export function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Format a score with context
 * e.g., 85 -> "85 (Good)"
 */
export function formatScore(score: number | null): string {
  if (score === null) return "No data";

  let label: string;
  if (score >= 85) label = "Optimal";
  else if (score >= 70) label = "Good";
  else if (score >= 60) label = "Fair";
  else label = "Pay attention";

  return `${score} (${label})`;
}

/**
 * Format Oura API height from meters to whole centimeters.
 */
export function formatHeight(heightMeters: number): string {
  return `${Math.round(heightMeters * 100)} cm`;
}

/**
 * Format sleep stages as a summary
 */
export function formatSleepStages(
  deep: number,
  rem: number,
  light: number,
  totalSleep: number
): string {
  const deepPct = percentage(deep, totalSleep);
  const remPct = percentage(rem, totalSleep);
  const lightPct = percentage(light, totalSleep);

  return [
    `Deep: ${formatDuration(deep)} (${deepPct}%)`,
    `REM: ${formatDuration(rem)} (${remPct}%)`,
    `Light: ${formatDuration(light)} (${lightPct}%)`,
  ].join(" | ");
}
