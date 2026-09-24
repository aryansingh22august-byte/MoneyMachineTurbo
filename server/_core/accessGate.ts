/**
 * Site-wide access gate.
 *
 * This is the shared-password layer that keeps casual visitors out of the UI.
 * It is deliberately separate from the OAuth session in `sdk.ts`, which is what
 * actually authorises `protectedProcedure` / `adminProcedure` calls.
 *
 * Previous behaviour this replaces:
 *   - password fell back to a literal committed in the source
 *   - the JWT was signed with the literal "fallback_secret"
 *   - the cookie was set with httpOnly:false and only ever inspected in the
 *     browser via `document.cookie`, so the token was never verified at all
 *   - unlimited password attempts
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Express, Request, Response } from "express";
import { COOKIE_NAME as SESSION_COOKIE_NAME } from "@shared/const";
import * as db from "../db";
import { sdk } from "./sdk";

const COOKIE_NAME = "auth_token";
const TOKEN_TTL_DAYS = 7;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Single-user local identity — replaces the Manus OAuth login. The access
// password is the only login: on success we mint a session for this fixed
// owner so protected procedures (watchlist, alerts) work with no OAuth.
const LOCAL_OWNER_OPENID = "local-owner";
const LOCAL_OWNER_NAME = "Owner";

/**
 * Signing secret for the gate token. SESSION_SECRET is preferred; JWT_SECRET is
 * accepted so existing deployments that only set the latter keep working.
 */
function resolveSecret(): string | undefined {
  return process.env.SESSION_SECRET || process.env.JWT_SECRET || undefined;
}

export interface AccessGateConfig {
  /** When false the gate is inert and every request is treated as allowed. */
  enabled: boolean;
  password?: string;
  secret?: string;
}

/**
 * Resolve and validate gate configuration.
 *
 * Fails closed in production: a missing password or signing secret aborts
 * startup rather than silently falling back to a value an attacker can read in
 * the repository. In development the gate simply switches off, loudly.
 */
export function resolveAccessGateConfig(): AccessGateConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const password = process.env.ACCESS_PASSWORD;
  const secret = resolveSecret();

  if (!password || !secret) {
    const missing = [
      !password ? "ACCESS_PASSWORD" : null,
      !secret ? "SESSION_SECRET (or JWT_SECRET)" : null,
    ].filter(Boolean).join(", ");

    if (isProduction) {
      throw new Error(
        `[AccessGate] Refusing to start: ${missing} must be set in production. ` +
        `These previously fell back to values hardcoded in the source, which meant ` +
        `anyone reading the repository could sign a valid session.`
      );
    }

    console.warn(
      `[AccessGate] ${missing} not set — access gate DISABLED for local development. ` +
      `The app will start unprotected. Set these before deploying.`
    );
    return { enabled: false };
  }

  return { enabled: true, password, secret };
}

/** Constant-time password comparison over fixed-width digests. */
function passwordMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// ── Per-IP attempt throttling ───────────────────────────────────────────────
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimitExceeded(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

function clearAttempts(ip: string) {
  attempts.delete(ip);
}

// Bound the map so a spray of distinct source IPs cannot grow it without limit.
const ATTEMPTS_SWEEP_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now >= entry.resetAt) attempts.delete(ip);
  }
}, ATTEMPTS_SWEEP_MS).unref?.();

/** True when the request carries a valid, unexpired gate token. */
export function hasValidAccessToken(req: Request, config: AccessGateConfig): boolean {
  if (!config.enabled) return true;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !config.secret) return false;
  try {
    // Pin the algorithm. Without this, verification accepts whatever `alg` the
    // token header declares, which is the classic JWT algorithm-confusion
    // foothold.
    jwt.verify(token, config.secret, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export function registerAccessGateRoutes(app: Express, config: AccessGateConfig) {
  const cookieOptions = {
    httpOnly: true, // the browser never needs to read this; only the server verifies it
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax" as const,
  };

  /**
   * Mint the single-user session after the access password verifies. This is
   * the "login": it writes the session cookie (app_session_id) for the fixed
   * local owner and upserts that user so protected procedures (watchlist,
   * alerts) authorise without any Manus OAuth round-trip.
   */
  async function establishLocalSession(res: Response): Promise<void> {
    const now = new Date().toISOString();
    const sessionToken = await sdk.signSession({
      openId: LOCAL_OWNER_OPENID,
      appId: "local",
      name: LOCAL_OWNER_NAME,
    });
    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      ...cookieOptions,
      maxAge: TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    await db.upsertUser({
      openId: LOCAL_OWNER_OPENID,
      name: LOCAL_OWNER_NAME,
      email: null,
      loginMethod: "local",
      role: "admin",
      lastSignedIn: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  app.post("/api/auth/verify", async (req: Request, res: Response) => {
    if (!config.enabled) {
      return res.status(200).json({ success: true, gateDisabled: true });
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (rateLimitExceeded(ip)) {
      return res.status(429).json({
        success: false,
        error: "Too many attempts. Try again later.",
      });
    }

    if (!passwordMatches(req.body?.password, config.password!)) {
      return res.status(401).json({ success: false, error: "Invalid password" });
    }

    clearAttempts(ip);
    const token = jwt.sign({ gate: true }, config.secret!, {
      algorithm: "HS256",
      expiresIn: `${TOKEN_TTL_DAYS}d`,
    });
    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions,
      maxAge: TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    await establishLocalSession(res);
    return res.status(200).json({ success: true });
  });

  /**
   * Server-verified replacement for the old `document.cookie.includes(...)`
   * check, which any visitor could satisfy from the browser console.
   */
  app.get("/api/auth/status", (req: Request, res: Response) => {
    res.status(200).json({
      authenticated: hasValidAccessToken(req, config),
      gateDisabled: !config.enabled,
    });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    res.status(200).json({ success: true });
  });
}
