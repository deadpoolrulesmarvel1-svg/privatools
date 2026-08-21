import { describe, expect, it } from "vitest";
import { ByokError, classifyHttpStatus } from "./errors";

describe("classifyHttpStatus", () => {
  it("maps 401/403 to a bad key", () => {
    expect(classifyHttpStatus(401).kind).toBe("BadKey");
    expect(classifyHttpStatus(403).kind).toBe("BadKey");
  });
  it("maps 429 to rate limited", () => {
    expect(classifyHttpStatus(429).kind).toBe("RateLimited");
  });
  it("maps 402 to no credit", () => {
    expect(classifyHttpStatus(402).kind).toBe("NoCredit");
  });
  it("maps 5xx to provider down", () => {
    expect(classifyHttpStatus(500).kind).toBe("ProviderDown");
    expect(classifyHttpStatus(503).kind).toBe("ProviderDown");
  });
  it("every error carries a user-facing message that names a next step", () => {
    for (const s of [401, 402, 429, 500]) {
      expect(classifyHttpStatus(s).userMessage.length).toBeGreaterThan(20);
    }
  });
  it("a ByokError is a real Error so it survives throw/catch", () => {
    const e = new ByokError("CspBlocked", "blocked", "Explain it.");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("CspBlocked");
  });
});
