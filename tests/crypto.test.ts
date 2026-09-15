import { describe, expect, it } from "vitest";
import { constantTimeEqual, hashToken, SecretBox } from "../src/platform/crypto.js";

describe("Worker credential protection", () => {
  it("round-trips encrypted JSON without exposing plaintext", async () => {
    const box = await SecretBox.fromBase64(Buffer.alloc(32, 9).toString("base64"));
    const encrypted = await box.encrypt({ refresh_token: "very-secret" });
    expect(encrypted).not.toContain("very-secret");
    await expect(box.decrypt(encrypted)).resolves.toEqual({ refresh_token: "very-secret" });
  });
  it("hashes tokens deterministically and compares CSRF values", async () => {
    await expect(hashToken("token")).resolves.toBe(await hashToken("token"));
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "different")).toBe(false);
  });
  it("rejects encryption keys of the wrong size", async () => {
    await expect(SecretBox.fromBase64(Buffer.alloc(16).toString("base64"))).rejects.toThrow(/32 bytes/);
  });
});
