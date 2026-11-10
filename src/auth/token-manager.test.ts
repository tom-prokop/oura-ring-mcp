import { describe, it, expect, vi } from "vitest";
import { TokenManager } from "./token-manager.js";
import type { OuraTokenSet } from "./oura-oauth.js";

const NOW = 1_700_000_000_000;
const set = (n: number, expiresIn = 3600_000): OuraTokenSet => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: "Bearer",
  expires_at: NOW + expiresIn,
});

describe("TokenManager", () => {
  it("returns the current token while it is valid", async () => {
    const refresh = vi.fn();
    const tm = new TokenManager({ initial: set(1), refresh, now: () => NOW });
    expect(await tm.getAccessToken()).toBe("access-1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes an expired token with the stored refresh token and persists the rotated one", async () => {
    const saved: OuraTokenSet[] = [];
    const refresh = vi.fn().mockResolvedValue(set(2));
    const tm = new TokenManager({
      initial: set(1, -1),
      refresh,
      save: async (t) => void saved.push(t),
      now: () => NOW,
    });

    expect(await tm.getAccessToken()).toBe("access-2");
    expect(refresh).toHaveBeenCalledWith("refresh-1");
    expect(saved).toEqual([set(2)]);
    expect(tm.current.refresh_token).toBe("refresh-2");
  });

  it("uses the NEW refresh token on the next refresh (rotation)", async () => {
    let clock = NOW;
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ ...set(2), expires_at: NOW + 1000 })
      .mockResolvedValueOnce(set(3));
    const tm = new TokenManager({ initial: set(1, -1), refresh, now: () => clock });

    await tm.getAccessToken();
    clock = NOW + 10_000; // set(2) now expired
    expect(await tm.getAccessToken()).toBe("access-3");
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["refresh-1", "refresh-2"]);
  });

  it("shares a single refresh between concurrent callers", async () => {
    let resolve!: (t: OuraTokenSet) => void;
    const refresh = vi.fn().mockReturnValue(new Promise<OuraTokenSet>((r) => (resolve = r)));
    const tm = new TokenManager({ initial: set(1, -1), refresh, now: () => NOW });

    const calls = Promise.all([tm.getAccessToken(), tm.getAccessToken(), tm.getAccessToken()]);
    resolve(set(2));
    expect(await calls).toEqual(["access-2", "access-2", "access-2"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the old tokens if saving fails, and lets a later call retry", async () => {
    const refresh = vi.fn().mockResolvedValue(set(2));
    const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const tm = new TokenManager({ initial: set(1, -1), refresh, save, now: () => NOW });

    await expect(tm.getAccessToken()).rejects.toThrow("disk full");
    expect(tm.current.access_token).toBe("access-1");
  });
});
