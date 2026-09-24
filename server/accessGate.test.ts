import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import {
  registerAccessGateRoutes,
  resolveAccessGateConfig,
  hasValidAccessToken,
} from "./_core/accessGate";

const PASSWORD = "correct-horse-battery-staple";
const SECRET = "0123456789abcdef0123456789abcdef";

function buildApp(config: Parameters<typeof registerAccessGateRoutes>[1]) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  registerAccessGateRoutes(app, config);
  return app;
}

/** Minimal fetch-style helper against an ephemeral listener. */
async function call(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  cookie?: string,
) {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      json: await res.json().catch(() => ({})),
      setCookie: res.headers.get("set-cookie") ?? "",
    };
  } finally {
    server.close();
  }
}

describe("resolveAccessGateConfig", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.JWT_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws in production when ACCESS_PASSWORD is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = SECRET;
    expect(() => resolveAccessGateConfig()).toThrow(/ACCESS_PASSWORD/);
  });

  it("throws in production when no signing secret is set", () => {
    process.env.NODE_ENV = "production";
    process.env.ACCESS_PASSWORD = PASSWORD;
    expect(() => resolveAccessGateConfig()).toThrow(/SESSION_SECRET/);
  });

  it("never falls back to a hardcoded password", () => {
    process.env.NODE_ENV = "development";
    const config = resolveAccessGateConfig();
    // The old implementation defaulted to a literal committed in the source.
    expect(config.enabled).toBe(false);
    expect(config.password).toBeUndefined();
  });

  it("accepts JWT_SECRET as an alias for SESSION_SECRET", () => {
    process.env.NODE_ENV = "production";
    process.env.ACCESS_PASSWORD = PASSWORD;
    process.env.JWT_SECRET = SECRET;
    expect(resolveAccessGateConfig()).toMatchObject({ enabled: true, secret: SECRET });
  });
});

describe("access gate routes", () => {
  const config = { enabled: true, password: PASSWORD, secret: SECRET };

  it("rejects a wrong password without issuing a cookie", async () => {
    const res = await call(buildApp(config), "POST", "/api/auth/verify", { password: "nope" });
    expect(res.status).toBe(401);
    expect(res.setCookie).toBe("");
  });

  it("issues an httpOnly cookie on the correct password", async () => {
    const res = await call(buildApp(config), "POST", "/api/auth/verify", { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ success: true });
    // httpOnly is the whole point: the previous cookie was readable by any
    // script via document.cookie.
    expect(res.setCookie.toLowerCase()).toContain("httponly");
  });

  it("tolerates a missing/!string password field", async () => {
    for (const body of [{}, { password: 123 }, { password: null }]) {
      const res = await call(buildApp(config), "POST", "/api/auth/verify", body);
      expect(res.status).toBe(401);
    }
  });

  it("throttles repeated failures with 429", async () => {
    const app = buildApp(config);
    let saw429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await call(app, "POST", "/api/auth/verify", { password: "wrong" });
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it("reports authenticated:false without a cookie", async () => {
    const res = await call(buildApp(config), "GET", "/api/auth/status");
    expect(res.json).toMatchObject({ authenticated: false });
  });

  it("reports authenticated:true for a validly signed cookie", async () => {
    const token = jwt.sign({ gate: true }, SECRET, { algorithm: "HS256", expiresIn: "1d" });
    const res = await call(buildApp(config), "GET", "/api/auth/status", undefined, `auth_token=${token}`);
    expect(res.json).toMatchObject({ authenticated: true });
  });
});

describe("hasValidAccessToken", () => {
  const config = { enabled: true, password: PASSWORD, secret: SECRET };
  const req = (token?: string) => ({ cookies: token ? { auth_token: token } : {} }) as any;

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign({ gate: true }, "some-other-secret", { algorithm: "HS256" });
    expect(hasValidAccessToken(req(forged), config)).toBe(false);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ gate: true }, SECRET, { algorithm: "HS256", expiresIn: -10 });
    expect(hasValidAccessToken(req(expired), config)).toBe(false);
  });

  it("rejects an unsigned alg:none token", () => {
    // Hand-rolled `{"alg":"none"}` token — the classic algorithm-confusion probe.
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ gate: true })}.`;
    expect(hasValidAccessToken(req(none), config)).toBe(false);
  });

  it("rejects a garbage cookie value", () => {
    expect(hasValidAccessToken(req("not-a-jwt"), config)).toBe(false);
  });

  it("accepts a valid token", () => {
    const token = jwt.sign({ gate: true }, SECRET, { algorithm: "HS256", expiresIn: "1d" });
    expect(hasValidAccessToken(req(token), config)).toBe(true);
  });

  it("is inert when the gate is disabled", () => {
    expect(hasValidAccessToken(req(), { enabled: false })).toBe(true);
  });
});
