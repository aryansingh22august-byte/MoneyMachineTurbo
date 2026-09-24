export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  /**
   * HS256 key for OAuth session JWTs (see sdk.ts `getSessionSecret`).
   * COOKIE_SECRET is accepted as an alias because .env.example and railway.toml
   * historically documented that name while the code only ever read JWT_SECRET,
   * which meant a deployment following the docs signed every session with an
   * empty key.
   */
  cookieSecret: process.env.JWT_SECRET ?? process.env.COOKIE_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

/**
 * Validate security-critical configuration at startup.
 *
 * Called before the server binds a port so a misconfigured production deploy
 * fails loudly instead of running with forgeable sessions.
 */
export function assertProductionEnv(): void {
  if (!ENV.isProduction) {
    if (!ENV.cookieSecret) {
      console.warn(
        "[Env] JWT_SECRET is not set — OAuth session tokens will be signed with " +
        "an empty key. Acceptable for local development only."
      );
    }
    return;
  }

  const problems: string[] = [];
  if (!ENV.cookieSecret) {
    problems.push("JWT_SECRET (or COOKIE_SECRET) must be set — an empty HS256 key lets anyone forge a session");
  } else if (ENV.cookieSecret.length < 32) {
    // A warning, not a hard failure: a short-but-random secret is weak rather
    // than broken, and refusing to boot over it would be disproportionate.
    console.warn(
      `[Env] JWT_SECRET is only ${ENV.cookieSecret.length} characters. ` +
      `Recommend at least 32 — generate with: openssl rand -hex 32`
    );
  }
  if (!ENV.databaseUrl) {
    problems.push("DATABASE_URL must be set");
  } else if (!/^postgres(ql)?:\/\//.test(ENV.databaseUrl)) {
    // db.ts connects with postgres-js against a pgTable schema. A file:/mysql:
    // URL cannot work: the connection fails and getDb() swallows it into a
    // warning, so the app boots "successfully" with every query returning
    // nothing. Better to refuse than to serve an empty dashboard.
    problems.push(
      `DATABASE_URL must be a postgres:// connection string, got "${ENV.databaseUrl.split(":")[0]}:…". ` +
      `The schema is PostgreSQL (drizzle/schema.ts uses pgTable) and the client is postgres-js; ` +
      `a file:/sqlite: or mysql:// URL connects to nothing and every query silently returns empty.`
    );
  }

  if (problems.length > 0) {
    throw new Error(`[Env] Refusing to start in production:\n  - ${problems.join("\n  - ")}`);
  }
}
