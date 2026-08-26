import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const RP_ID = process.env.RP_ID || "pocket.patelviren.com";
export const ORIGIN = process.env.ORIGIN || `https://${RP_ID}`;
export const SESSION_COOKIE_NAME = "ledger_session";
// Safety-net expiry embedded in the token itself, even though the cookie
// is a session cookie (cleared when the browser/tab closes).
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL");
  }
  return createClient(url, serviceKey);
}

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
  // No Max-Age/Expires => browser session cookie, cleared on browser/tab close.
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function createSessionToken() {
  const secret = process.env.APP_SESSION_SECRET;
  const expiry = Date.now() + TOKEN_MAX_AGE_MS;
  const payload = String(expiry);
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!token || !secret) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  return Number(payload) > Date.now();
}

export function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}
