/**
 * Thin wrapper around the Oura API v2
 * https://cloud.ouraring.com/v2/docs
 */

import type { components } from "./types/oura-api.js";
import { OuraApiError } from "./utils/errors.js";

const BASE_URL = "https://api.ouraring.com/v2/usercollection";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HEARTRATE_PAGES = 20;

/**
 * Add days to a YYYY-MM-DD date string
 */
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

// Re-export commonly used types for convenience
export type SleepSession = components["schemas"]["SleepModel"];
export type DailySleep = components["schemas"]["DailySleepModel"];
export type DailyReadiness = components["schemas"]["DailyReadinessModel"];
export type DailyActivity = components["schemas"]["DailyActivityModel"];
export type DailyStress = components["schemas"]["DailyStressModel"];
export type HeartRate = components["schemas"]["HeartRateModel"];
export type Workout = components["schemas"]["PublicWorkout"];
export type DailySpo2 = components["schemas"]["DailySpO2Model"];
export type VO2Max = components["schemas"]["VO2MaxModel"];
export type PersonalInfo = components["schemas"]["PersonalInfoResponse"];
export type DailyResilience = components["schemas"]["DailyResilienceModel"];
export type DailyCardiovascularAge = components["schemas"]["DailyCardiovascularAgeModel"];
export type Tag = components["schemas"]["TagModel"];
export type EnhancedTag = components["schemas"]["EnhancedTagModel"];
export type Session = components["schemas"]["SessionModel"];
export type RestModePeriod = components["schemas"]["RestModePeriodModel"];
export type RingConfiguration = components["schemas"]["RingConfigurationModel"];
export type SleepTime = components["schemas"]["SleepTimeModel"];

export interface OuraClientConfig {
  accessToken: string;
  /**
   * Optional async token source, called before every request. Lets long-running
   * hosts refresh expired OAuth tokens on demand (see auth/token-manager.ts).
   * Cleared by setAccessToken(). Hosts serving several users must create one
   * client per user/session instead of sharing an instance.
   */
  getAccessToken?: () => Promise<string>;
}

// Generic response wrapper from Oura API
export interface OuraResponse<T> {
  data: T[];
  next_token?: string | null;
}

export class OuraClient {
  private accessToken: string;
  private tokenSource?: () => Promise<string>;

  constructor(config: OuraClientConfig) {
    this.accessToken = config.accessToken;
    this.tokenSource = config.getAccessToken;
  }

  /**
   * Update the access token (e.g., after OAuth flow completes)
   */
  setAccessToken(token: string): void {
    // An explicitly set token always wins: drop any async token source so a
    // previously attached credential store can never answer for this client.
    this.accessToken = token;
    this.tokenSource = undefined;
  }

  private async fetch<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${BASE_URL}/${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const token = this.tokenSource ? await this.tokenSource() : this.accessToken;
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new OuraApiError(response.status, response.statusText, body);
    }

    return response.json() as Promise<T>;
  }

  // ─────────────────────────────────────────────────────────────
  // Sleep endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailySleep(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailySleep>>("daily_sleep", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  async getSleep(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for single-date queries (start == end)
    // on the /sleep endpoint. We expand the range by ±1 day and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -1);
      queryEnd = addDays(endDate, 1);
    }

    const response = await this.fetch<OuraResponse<SleepSession>>("sleep", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include sessions within the originally requested date range
    if (isSingleDate) {
      response.data = response.data.filter(
        (session) => session.day >= startDate && session.day <= endDate
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // Readiness endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailyReadiness(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailyReadiness>>("daily_readiness", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Activity endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailyActivity(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for single-date queries (start == end)
    // on the /daily_activity endpoint. We expand the range by ±1 day and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -1);
      queryEnd = addDays(endDate, 1);
    }

    const response = await this.fetch<OuraResponse<DailyActivity>>("daily_activity", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include data within the originally requested date range
    if (isSingleDate) {
      response.data = response.data.filter(
        (item) => item.day >= startDate && item.day <= endDate
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // Stress endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailyStress(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailyStress>>("daily_stress", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Heart rate endpoints
  // ─────────────────────────────────────────────────────────────

  /**
   * The /heartrate endpoint takes start_datetime/end_datetime (not
   * start_date/end_date, which it silently ignores - upstream issue #12).
   * Plain YYYY-MM-DD dates are expanded to cover whole days: start at
   * 00:00 on startDate, end at 00:00 on the day after endDate. Full ISO
   * datetimes are passed through unchanged. Results are paginated via
   * next_token; we follow up to MAX_HEARTRATE_PAGES pages.
   */
  async getHeartRate(start: string, end: string) {
    const startDatetime = DATE_ONLY.test(start) ? `${start}T00:00:00` : start;
    const endDatetime = DATE_ONLY.test(end) ? `${addDays(end, 1)}T00:00:00` : end;

    const data: HeartRate[] = [];
    let nextToken: string | null | undefined;
    let pages = 0;
    do {
      const params: Record<string, string> = {
        start_datetime: startDatetime,
        end_datetime: endDatetime,
      };
      if (nextToken) params.next_token = nextToken;
      const page = await this.fetch<OuraResponse<HeartRate>>("heartrate", params);
      data.push(...page.data);
      nextToken = page.next_token;
      pages++;
    } while (nextToken && pages < MAX_HEARTRATE_PAGES);

    return { data, next_token: nextToken ?? null } as OuraResponse<HeartRate>;
  }

  // ─────────────────────────────────────────────────────────────
  // Workout endpoints
  // ─────────────────────────────────────────────────────────────

  async getWorkouts(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for single-date queries (start == end)
    // on the /workout endpoint. We expand the range by ±1 day and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -1);
      queryEnd = addDays(endDate, 1);
    }

    const response = await this.fetch<OuraResponse<Workout>>("workout", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include workouts within the originally requested date range
    if (isSingleDate) {
      response.data = response.data.filter(
        (item) => item.day >= startDate && item.day <= endDate
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // SpO2 endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailySpo2(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailySpo2>>("daily_spo2", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // VO2 Max endpoints
  // ─────────────────────────────────────────────────────────────

  async getVO2Max(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<VO2Max>>("vO2_max", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Resilience endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailyResilience(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailyResilience>>("daily_resilience", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Cardiovascular age endpoints
  // ─────────────────────────────────────────────────────────────

  async getDailyCardiovascularAge(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<DailyCardiovascularAge>>("daily_cardiovascular_age", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Tag endpoints
  // ─────────────────────────────────────────────────────────────

  async getTags(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for single-date queries (start == end)
    // on the /tag endpoint. We expand the range by ±1 day and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -1);
      queryEnd = addDays(endDate, 1);
    }

    const response = await this.fetch<OuraResponse<Tag>>("tag", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include tags within the originally requested date range
    if (isSingleDate) {
      response.data = response.data.filter(
        (item) => item.day >= startDate && item.day <= endDate
      );
    }

    return response;
  }

  async getEnhancedTags(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for narrow date ranges on /enhanced_tag.
    // Unlike other endpoints (±1 day), this one needs at least ±2 days to work.
    // We expand by ±3 days to be safe and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -3);
      queryEnd = addDays(endDate, 3);
    }

    const response = await this.fetch<OuraResponse<EnhancedTag>>("enhanced_tag", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include tags within the originally requested date range
    // EnhancedTag uses start_day instead of day
    if (isSingleDate) {
      response.data = response.data.filter(
        (item) => item.start_day >= startDate && item.start_day <= endDate
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // Session endpoints
  // ─────────────────────────────────────────────────────────────

  async getSessions(startDate: string, endDate: string) {
    // WORKAROUND: Oura API returns empty results for single-date queries (start == end)
    // on the /session endpoint. We expand the range by ±1 day and filter client-side.
    const isSingleDate = startDate === endDate;

    let queryStart = startDate;
    let queryEnd = endDate;

    if (isSingleDate) {
      queryStart = addDays(startDate, -1);
      queryEnd = addDays(endDate, 1);
    }

    const response = await this.fetch<OuraResponse<Session>>("session", {
      start_date: queryStart,
      end_date: queryEnd,
    });

    // Filter to only include sessions within the originally requested date range
    if (isSingleDate) {
      response.data = response.data.filter(
        (item) => item.day >= startDate && item.day <= endDate
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────
  // Rest mode endpoints
  // ─────────────────────────────────────────────────────────────

  async getRestModePeriods(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<RestModePeriod>>("rest_mode_period", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Ring configuration endpoints
  // ─────────────────────────────────────────────────────────────

  async getRingConfiguration() {
    // This endpoint returns all rings without date params
    return this.fetch<OuraResponse<RingConfiguration>>("ring_configuration");
  }

  // ─────────────────────────────────────────────────────────────
  // Sleep time endpoints
  // ─────────────────────────────────────────────────────────────

  async getSleepTime(startDate: string, endDate: string) {
    return this.fetch<OuraResponse<SleepTime>>("sleep_time", {
      start_date: startDate,
      end_date: endDate,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Other endpoints
  // ─────────────────────────────────────────────────────────────

  async getPersonalInfo() {
    return this.fetch<PersonalInfo>("personal_info");
  }
}
