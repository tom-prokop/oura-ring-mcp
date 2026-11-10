/**
 * HTML for the consent and error pages. Every dynamic value is escaped:
 * client names, URIs and scopes come from dynamic registration / CIMD
 * documents and are attacker-controlled.
 */
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"'`=/]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Headers for every HTML page we render ourselves. */
export function htmlHeaders(extra?: Headers): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
  );
  return headers;
}

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1b1b1f}
h1{font-size:1.4rem}.box{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
button{font:inherit;padding:.5rem 1.2rem;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer}
button.primary{background:#1b1b1f;color:#fff;border-color:#1b1b1f}.warn{color:#9a3412}code{word-break:break-all}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName || "An unnamed app");
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>`
    : "";
  return page(
    `Connect ${details.clientName || "app"} to Oura`,
    `<h1>Allow ${name} to read your Oura data?</h1>
<div class="box"><p>${origin}</p>
<p>Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
<p>It will be able to <strong>read</strong> your sleep, readiness, activity, heart rate and other Oura data. It cannot change anything.</p></div>
${loopback}
<p>Next you'll sign in with Oura. Only the allowed Oura account can finish.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<button class="primary" name="decision" value="approve">Continue to Oura</button>
<button name="decision" value="deny">Deny</button>
</form>`
  );
}

export function messagePage(title: string, message: string, detailHtml = ""): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${detailHtml}`);
}

/** Shown when the allowlist isn't configured, so the owner can learn their own Oura id. */
export function setupNeededPage(identity: { id?: string | null; email?: string | null }): string {
  return messagePage(
    "Allowlist not configured",
    "This server refuses every Oura account until an allowlist is set. If this is your Oura account, set one of these secrets and sign in again:",
    `<div class="box"><p><code>wrangler secret put ALLOWED_OURA_USER_ID</code><br>value: <code>${escapeHtml(identity.id)}</code></p>
<p><code>wrangler secret put ALLOWED_OURA_EMAIL</code><br>value: <code>${escapeHtml(identity.email)}</code></p></div>`
  );
}
