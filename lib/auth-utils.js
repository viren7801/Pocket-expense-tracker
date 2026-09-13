import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const RP_ID = process.env.RP_ID || "pocket.patelviren.com";

export const ORIGIN = process.env.ORIGIN || `https://${RP_ID}`;

export const SESSION_COOKIE_NAME = "ledger_session";

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/*
 * ==========================================================
 * SUPABASE
 * ==========================================================
 */

export function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL");
  }

  return createClient(url, serviceKey);
}

/*
 * ==========================================================
 * COOKIES
 * ==========================================================
 */

export function parseCookies(header) {
  const out = {};

  if (!header) return out;

  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");

    if (idx === -1) return;

    out[pair.slice(0, idx).trim()] = decodeURIComponent(
      pair.slice(idx + 1).trim(),
    );
  });

  return out;
}

export function serializeSessionCookie(value) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    value,
  )}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/*
 * ==========================================================
 * SESSION TOKEN
 * ==========================================================
 *
 * The session now stores:
 *
 * {
 *   exp: <expiration timestamp>,
 *   credentialId: <WebAuthn credential that authenticated>
 * }
 *
 * The entire payload is HMAC signed.
 */

export function createSessionToken(credentialId = null) {
  const secret = process.env.APP_SESSION_SECRET;

  if (!secret) {
    throw new Error("Missing APP_SESSION_SECRET");
  }

  const expiry = Date.now() + TOKEN_MAX_AGE_MS;

  const payload = Buffer.from(
    JSON.stringify({
      exp: expiry,
      credentialId: credentialId || null,
    }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

export function readSessionToken(token) {
  const secret = process.env.APP_SESSION_SECRET;

  if (!token || !secret) {
    return null;
  }

  const separator = token.lastIndexOf(".");

  if (separator === -1) {
    return null;
  }

  const payload = token.slice(0, separator);

  const signature = token.slice(separator + 1);

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");

  const expectedBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );

    if (!decoded || typeof decoded.exp !== "number") {
      return null;
    }

    if (decoded.exp <= Date.now()) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);

  return readSessionToken(cookies[SESSION_COOKIE_NAME]);
}

export function isAuthenticated(req) {
  return Boolean(getSession(req));
}

export function getSessionCredentialId(req) {
  return getSession(req)?.credentialId || null;
}

/*
 * ==========================================================
 * BODY
 * ==========================================================
 */

export async function readJsonBody(req) {
  let body = req.body;

  if (!body) {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString("utf8");

    return JSON.parse(raw || "{}");
  }

  if (typeof body === "string") {
    return JSON.parse(body || "{}");
  }

  return body;
}
