import { describe, expect, it } from "vitest";
import { SecretBox, verifyPkce } from "../src/infrastructure/crypto.js";
import { createHash } from "node:crypto";

describe("credential protection", () => {
  it("round-trips encrypted JSON without exposing plaintext", () => {
    const box = new SecretBox(Buffer.alloc(32, 9));
    const encrypted = box.encrypt({ refresh_token: "very-secret" });
    expect(encrypted).not.toContain("very-secret");
    expect(box.decrypt(encrypted)).toEqual({ refresh_token: "very-secret" });
  });

  it("verifies an S256 PKCE pair", () => {
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("x".repeat(64), challenge)).toBe(false);
  });
});

