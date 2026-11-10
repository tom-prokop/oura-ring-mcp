import { describe, it, expect } from "vitest";
import { checkAllowlist } from "./allowlist.js";

const tom = { id: "tom-oura-id", email: "Tom@Example.com" };

describe("checkAllowlist", () => {
  it("refuses everyone when nothing is configured (on by default)", () => {
    expect(checkAllowlist(tom, {})).toEqual({ allowed: false, reason: "not_configured" });
    expect(checkAllowlist(tom, { ALLOWED_OURA_USER_ID: "  ", ALLOWED_OURA_EMAIL: "" })).toEqual({
      allowed: false,
      reason: "not_configured",
    });
  });

  it("allows a matching user id", () => {
    expect(checkAllowlist(tom, { ALLOWED_OURA_USER_ID: "tom-oura-id" })).toEqual({ allowed: true });
    expect(checkAllowlist(tom, { ALLOWED_OURA_USER_ID: " tom-oura-id\n" })).toEqual({ allowed: true });
  });

  it("refuses a different user id", () => {
    expect(checkAllowlist({ id: "someone-else" }, { ALLOWED_OURA_USER_ID: "tom-oura-id" })).toEqual({
      allowed: false,
      reason: "mismatch",
    });
    expect(checkAllowlist({}, { ALLOWED_OURA_USER_ID: "tom-oura-id" }).allowed).toBe(false);
  });

  it("matches email case-insensitively", () => {
    expect(checkAllowlist(tom, { ALLOWED_OURA_EMAIL: "tom@example.com" })).toEqual({ allowed: true });
    expect(checkAllowlist({ id: "x", email: null }, { ALLOWED_OURA_EMAIL: "tom@example.com" }).allowed).toBe(false);
    expect(checkAllowlist({ id: "x", email: "tom@example.com.evil" }, { ALLOWED_OURA_EMAIL: "tom@example.com" }).allowed).toBe(false);
  });

  it("requires every configured check to pass", () => {
    const both = { ALLOWED_OURA_USER_ID: "tom-oura-id", ALLOWED_OURA_EMAIL: "tom@example.com" };
    expect(checkAllowlist(tom, both)).toEqual({ allowed: true });
    expect(checkAllowlist({ ...tom, id: "other" }, both).allowed).toBe(false);
    expect(checkAllowlist({ ...tom, email: "other@example.com" }, both).allowed).toBe(false);
  });

  it("can be disabled explicitly", () => {
    expect(checkAllowlist({ id: "anyone" }, { ALLOW_ANY_OURA_USER: "true" })).toEqual({ allowed: true });
    expect(checkAllowlist({ id: "anyone" }, { ALLOW_ANY_OURA_USER: "yes" }).allowed).toBe(false);
  });
});
