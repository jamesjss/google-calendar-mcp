import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../config.js";
import type { RefreshGrant } from "../infrastructure/store.js";

export class SessionTokens {
  private readonly secret: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  issueAccessToken(grant: RefreshGrant): Promise<string> {
    return new SignJWT({ scope: grant.scope, client_id: grant.clientId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.config.PUBLIC_BASE_URL)
      .setAudience(`${this.config.PUBLIC_BASE_URL}/mcp`)
      .setSubject(grant.subject)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<{ subject: string; clientId: string; scope: string }> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.config.PUBLIC_BASE_URL,
      audience: `${this.config.PUBLIC_BASE_URL}/mcp`,
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.client_id !== "string" || typeof payload.scope !== "string") {
      throw new Error("Access token claims are incomplete");
    }
    return { subject: payload.sub, clientId: payload.client_id, scope: payload.scope };
  }
}
