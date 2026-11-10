import { describe, it, expect } from "vitest";
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { consentPage, escapeHtml, htmlHeaders, messagePage, setupNeededPage } from "./html.js";

const XSS = `"><script>alert('x')</script><img src=x onerror=alert(1)>`;

describe("escapeHtml", () => {
  it("escapes markup and quote characters", () => {
    const out = escapeHtml(XSS);
    expect(out).not.toMatch(/[<>"']/);
    expect(out).toContain("&#60;script&#62;");
  });

  it("handles null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("consentPage", () => {
  const details: ConsentDescription = {
    clientId: "cid",
    clientName: XSS,
    clientDomain: `evil.example${XSS}`,
    redirectUri: "https://evil.example/cb",
    redirectHost: `host${XSS}`,
    redirectIsLoopback: true,
    scope: [XSS],
  } as ConsentDescription;

  it("escapes every client-controlled value", () => {
    const page = consentPage(details, `handle${XSS}`);
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("<img");
    expect(page).not.toContain('value="handle"');
    expect(page).toContain('value="handle&#34;&#62;');
    expect(page).toContain("app on your computer");
  });

  it("marks self-registered clients as unverified", () => {
    const page = consentPage({ ...details, clientDomain: undefined, redirectIsLoopback: false }, "h");
    expect(page).toContain("not verified");
    expect(page).not.toContain("app on your computer");
  });
});

describe("other pages", () => {
  it("escapes message and setup pages", () => {
    expect(messagePage(XSS, XSS)).not.toContain("<script>");
    const setup = setupNeededPage({ id: XSS, email: XSS });
    expect(setup).not.toContain("<script>");
    expect(setup).toContain("ALLOWED_OURA_USER_ID");
  });

  it("sends no-store, nosniff and anti-framing headers", () => {
    const h = htmlHeaders(new Headers({ "Set-Cookie": "a=b" }));
    expect(h.get("Cache-Control")).toBe("no-store");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(h.get("Set-Cookie")).toBe("a=b");
  });
});
