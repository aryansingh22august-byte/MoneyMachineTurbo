import express from "express";
import axios from "axios";

export const upstoxRouter = express.Router();

let currentAccessToken: string | null = process.env.UPSTOX_ACCESS_TOKEN || null;
let _expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Decode the JWT payload (no signature verification — just read expiry) */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Schedule server-side token expiry awareness (Audit #1).
 * - Logs warning 5 min before expiry
 * - Auto-clears expired token so streamer reconnect loop knows to stop
 * - Upstox does NOT support refresh_token grant — daily re-auth via OAuth is required
 */
function scheduleTokenExpiryCheck() {
  if (_expiryTimer) {
    clearTimeout(_expiryTimer);
    _expiryTimer = null;
  }

  if (!currentAccessToken) return;

  const payload = decodeJwtPayload(currentAccessToken);
  if (!payload || typeof payload.exp !== "number") return;

  const nowMs = Date.now();
  const expiryMs = payload.exp * 1000;
  const remainingMs = expiryMs - nowMs;

  if (remainingMs <= 0) {
    console.warn("[Upstox] Token already expired — clearing");
    currentAccessToken = null;
    return;
  }

  // Warn 5 minutes before expiry
  const warnAt = Math.max(remainingMs - 5 * 60 * 1000, 1000);
  _expiryTimer = setTimeout(() => {
    console.warn("[Upstox] ⚠️ Token expires in ~5 minutes! User must re-authenticate via /api/upstox/login");

    // Schedule final clear at actual expiry
    const clearDelay = Math.max(expiryMs - Date.now(), 1000);
    _expiryTimer = setTimeout(() => {
      console.warn("[Upstox] 🔴 Token expired — clearing. Live data stopped.");
      currentAccessToken = null;
    }, clearDelay);
  }, warnAt);

  const mins = Math.round(remainingMs / 60_000);
  console.log(`[Upstox] Token valid for ~${mins} minutes. Expiry warning scheduled.`);
}

/** Returns structured token status for the frontend badge */
function getTokenStatus() {
  const loginUrl = "/api/upstox/login";

  if (!currentAccessToken) {
    return { hasToken: false, isValid: false, expiresAt: null, expiresInSeconds: null, loginUrl };
  }

  const payload = decodeJwtPayload(currentAccessToken);
  if (!payload || typeof payload.exp !== "number") {
    return { hasToken: true, isValid: false, expiresAt: null, expiresInSeconds: 0, loginUrl };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresInSeconds = payload.exp - nowSec;
  const isValid = expiresInSeconds > 30;
  const expiresAt = new Date(payload.exp * 1000).toISOString();

  return { hasToken: true, isValid, expiresAt, expiresInSeconds, loginUrl };
}

// ── GET /status — lightweight heartbeat for the frontend badge ────────────────
upstoxRouter.get("/status", (_req, res) => {
  res.json(getTokenStatus());
});

export const getUpstoxAccessToken = () => currentAccessToken;

upstoxRouter.get("/login", (req, res) => {
  const apiKey = process.env.UPSTOX_API_KEY;
  const host = req.get("host") || "localhost:3000";
  const defaultRedirect = `${req.protocol}://${host}/api/upstox/callback`;
  const redirectUri = encodeURIComponent(process.env.UPSTOX_REDIRECT_URI || defaultRedirect);
  const state = Math.random().toString(36).substring(7);
  
  if (!apiKey || !redirectUri) {
    console.error("[Upstox] Configuration missing: UPSTOX_API_KEY or UPSTOX_REDIRECT_URI");
    return res.status(500).send("Upstox configuration missing on server.");
  }

  // Back to official v2 dialog endpoint — login.upstox.com was too aggressive and bypassed authorization
  const url = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${redirectUri}&state=${state}`;
  
  console.log(`[Upstox] Initiating OAuth: ${url}`);
  res.redirect(url);
});

// ── GET /callback — Upstox redirects here with ?code=XXX after login ──────────
upstoxRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ No authorization code received</h2>
        <p>Upstox did not send a code. Try logging in again at
          <a href="/api/upstox/login">/api/upstox/login</a>
        </p>
      </body></html>
    `);
  }

  try {
    const data = new URLSearchParams({
      code,
      client_id: process.env.UPSTOX_API_KEY!,
      client_secret: process.env.UPSTOX_API_SECRET!,
      redirect_uri: process.env.UPSTOX_REDIRECT_URI || `${req.protocol}://${req.get("host") || "localhost:3000"}/api/upstox/callback`,
      grant_type: "authorization_code",
    });

    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      data.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    if (response.data.access_token) {
      currentAccessToken = response.data.access_token;
      console.log("[Upstox] ✅ Access Token stored successfully!");

      // Schedule server-side expiry monitoring
      scheduleTokenExpiryCheck();

      // Immediately try to connect the streamer with the new token
      import("./upstoxStreamer").then(({ connectUpstoxStreamer }) => {
        void connectUpstoxStreamer();
      }).catch(console.error);

      return res.send(`
        <html><head><title>Upstox Connected</title></head><body style="font-family:sans-serif;padding:40px;background:#0f0f1a;color:#fff;text-align:center">
          <div style="max-width:420px;margin:40px auto;padding:32px;border:1px solid #10b981;border-radius:16px;background:#0a2a1f">
            <div style="font-size:48px;margin-bottom:16px">✅</div>
            <h2 style="color:#10b981;margin-bottom:8px">Upstox Connected!</h2>
            <p style="color:#a7f3d0;font-size:14px;margin-bottom:24px">Live market data is now streaming to your dashboard.</p>
            <p style="color:#6b7280;font-size:13px">You can now <strong style="color:#fff">close this tab</strong> and return to your dashboard.<br/>The status button will update automatically.</p>
            <div style="margin-top:28px;padding:12px;background:#0f2d1f;border-radius:8px;font-size:11px;color:#4b5563">
              Token prefix: ${(currentAccessToken ?? '').slice(0, 20)}...
            </div>
          </div>
          <script>
            // Auto-close the tab after 3 seconds
            setTimeout(function(){ window.close(); }, 3000);
          </script>
        </body></html>
      `);
    } else {
      throw new Error("No access_token in response");
    }
  } catch (error: any) {
    console.error("[Upstox] Token exchange error:", error.response?.data || error.message);
    const detail = JSON.stringify(error.response?.data ?? error.message, null, 2);
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Token Exchange Failed</h2>
        <pre style="background:#f5f5f5;padding:16px;border-radius:8px">${detail}</pre>
        <p>Try logging in again at <a href="/api/upstox/login">/api/upstox/login</a></p>
      </body></html>
    `);
  }
});

// ── POST /callback — for manual server-side token exchange ───────────────────
upstoxRouter.post("/callback", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const data = new URLSearchParams({
      code,
      client_id: process.env.UPSTOX_API_KEY!,
      client_secret: process.env.UPSTOX_API_SECRET!,
      redirect_uri: process.env.UPSTOX_REDIRECT_URI!,
      grant_type: "authorization_code",
    });

    const response = await axios.post("https://api.upstox.com/v2/login/authorization/token", data.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    });

    if (response.data.access_token) {
      currentAccessToken = response.data.access_token;
      console.log("[Upstox] Successfully generated and stored Access Token!");
      scheduleTokenExpiryCheck();

      // Immediately connect streamer
      import("./upstoxStreamer").then(({ connectUpstoxStreamer }) => {
        void connectUpstoxStreamer();
      }).catch(console.error);

      res.json({ success: true, message: "Upstox authenticated successfully." });
    } else {
      res.status(400).json({ error: "No token in response", data: response.data });
    }
  } catch (error: any) {
    console.error("[Upstox] Token exchange error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to exchange code", details: error.response?.data });
  }
});

// Boot: if token was loaded from env, schedule expiry check right away
if (currentAccessToken) {
  scheduleTokenExpiryCheck();
}

