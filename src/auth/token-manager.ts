/**
 * Keeps an Oura access token fresh for a long-running process.
 *
 * - Refreshes shortly before expiry (bufferMs).
 * - Single-flight: concurrent callers share one refresh. This matters because
 *   Oura refresh tokens are single-use — two parallel refreshes with the same
 *   token would make the second fail and could strand the stored credentials.
 * - Persists the rotated token set via `save` before handing out the new
 *   access token.
 */

import { isTokenExpired, type OuraTokenSet } from "./oura-oauth.js";

export interface TokenManagerOptions {
  initial: OuraTokenSet;
  refresh: (refreshToken: string) => Promise<OuraTokenSet>;
  save?: (tokens: OuraTokenSet) => Promise<void>;
  bufferMs?: number;
  now?: () => number;
}

export class TokenManager {
  private tokens: OuraTokenSet;
  private inflight: Promise<OuraTokenSet> | null = null;
  private readonly opts: TokenManagerOptions;

  constructor(opts: TokenManagerOptions) {
    this.opts = opts;
    this.tokens = opts.initial;
  }

  get current(): OuraTokenSet {
    return this.tokens;
  }

  async getAccessToken(): Promise<string> {
    const now = this.opts.now?.() ?? Date.now();
    if (!isTokenExpired(this.tokens, this.opts.bufferMs ?? 60_000, now)) {
      return this.tokens.access_token;
    }
    return (await this.forceRefresh()).access_token;
  }

  forceRefresh(): Promise<OuraTokenSet> {
    if (!this.inflight) {
      const usedRefreshToken = this.tokens.refresh_token;
      this.inflight = (async () => {
        const next = await this.opts.refresh(usedRefreshToken);
        if (this.opts.save) await this.opts.save(next);
        this.tokens = next;
        return next;
      })().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }
}
