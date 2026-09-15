import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_BASE_URL: z.string().url().transform((value) => value.replace(/\/$/, "")),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DEFAULT_TIME_ZONE: z.literal("Europe/Madrid").default("Europe/Madrid"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().transform((value, ctx) => {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) {
      ctx.addIssue({ code: "custom", message: "must decode to exactly 32 bytes" });
      return z.NEVER;
    }
    return decoded;
  }),
  JWT_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().min(1).default("./data/calendar-mcp.sqlite"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(120).max(1800).default(600),
  ALLOWED_REDIRECT_ORIGINS: z.string().default("").transform((value) =>
    value.split(",").map((entry) => entry.trim()).filter(Boolean),
  ),
  ALLOWED_GOOGLE_EMAILS: z.string().default("").transform((value) =>
    value.split(",").map((entry) => entry.trim().toLocaleLowerCase("en")).filter(Boolean),
  ),
});

export type AppConfig = z.output<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  if (result.data.NODE_ENV === "production" && !result.data.PUBLIC_BASE_URL.startsWith("https://")) {
    throw new Error("Invalid configuration: PUBLIC_BASE_URL must use HTTPS in production");
  }
  if (result.data.NODE_ENV === "production" && result.data.ALLOWED_REDIRECT_ORIGINS.length === 0) {
    throw new Error("Invalid configuration: ALLOWED_REDIRECT_ORIGINS is required in production");
  }
  return result.data;
}
