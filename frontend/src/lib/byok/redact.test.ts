import { describe, expect, it } from "vitest";
import { redact, registerSecret, _clearSecretsForTests } from "./redact";

describe("redact", () => {
  it("removes a registered secret from a string", () => {
    _clearSecretsForTests();
    registerSecret("sk-ant-abc123SECRET");
    expect(redact("failed with key sk-ant-abc123SECRET")).not.toContain("SECRET");
    expect(redact("failed with key sk-ant-abc123SECRET")).toContain("[redacted]");
  });

  it("redacts inside nested objects and arrays", () => {
    _clearSecretsForTests();
    registerSecret("TOPSECRET");
    const out = redact({ a: ["x", { b: "has TOPSECRET inside" }] });
    expect(JSON.stringify(out)).not.toContain("TOPSECRET");
  });

  it("redacts an Error's message and stack", () => {
    _clearSecretsForTests();
    registerSecret("LEAKY-ENOUGH-TO-REGISTER");
    const out = redact(new Error("boom LEAKY-ENOUGH-TO-REGISTER")) as { message: string };
    expect(out.message).not.toContain("LEAKY-ENOUGH-TO-REGISTER");
    expect(out.message).toContain("[redacted]");
  });

  it("ignores secrets under 8 characters, on purpose", () => {
    // Registering a short string would redact it everywhere it appeared,
    // mangling innocent text — "key", "test", a user's initials. Real API
    // keys are 40+ characters, so the floor costs nothing and prevents the
    // redactor from becoming the bug.
    _clearSecretsForTests();
    registerSecret("abc");
    expect(redact("abc is a normal word")).toBe("abc is a normal word");
  });

  it("catches key-shaped strings even when not registered", () => {
    _clearSecretsForTests();
    expect(redact("Bearer sk-proj-AbCdEf0123456789AbCdEf0123456789")).toContain("[redacted]");
    expect(redact("x-api-key: sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZ")).toContain("[redacted]");
  });

  it("leaves innocent text alone", () => {
    _clearSecretsForTests();
    expect(redact("could not reach the provider")).toBe("could not reach the provider");
  });

  it("does not choke on circular structures", () => {
    _clearSecretsForTests();
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});
