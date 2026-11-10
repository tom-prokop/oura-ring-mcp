/**
 * Single-user allowlist: only the configured Oura account may finish
 * sign-in. On by default — with nothing configured, everyone is refused.
 */
import type { Env } from "./config.js";

export interface OuraIdentity {
  id?: string | null;
  email?: string | null;
}

export type AllowlistDecision =
  | { allowed: true }
  | { allowed: false; reason: "not_configured" | "mismatch" };

export function checkAllowlist(
  identity: OuraIdentity,
  env: Pick<Env, "ALLOWED_OURA_USER_ID" | "ALLOWED_OURA_EMAIL" | "ALLOW_ANY_OURA_USER">
): AllowlistDecision {
  if (env.ALLOW_ANY_OURA_USER?.trim().toLowerCase() === "true") {
    return { allowed: true };
  }

  const wantId = env.ALLOWED_OURA_USER_ID?.trim();
  const wantEmail = env.ALLOWED_OURA_EMAIL?.trim().toLowerCase();
  if (!wantId && !wantEmail) {
    return { allowed: false, reason: "not_configured" };
  }

  // Every configured check must pass.
  if (wantId && identity.id?.trim() !== wantId) {
    return { allowed: false, reason: "mismatch" };
  }
  if (wantEmail && identity.email?.trim().toLowerCase() !== wantEmail) {
    return { allowed: false, reason: "mismatch" };
  }
  return { allowed: true };
}
