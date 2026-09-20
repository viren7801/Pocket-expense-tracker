import crypto from "node:crypto";
import {
  getServiceClient,
  getSessionCredentialId,
  isAuthenticated,
  readJsonBody,
} from "../lib/auth-utils.js";
import { sendPushToAll } from "../lib/push.js";

const json = (res, status, body) => res.status(status).json(body);

function localDev(req) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  return (host === "localhost" || host === "127.0.0.1") && process.env.VERCEL_ENV !== "production";
}

function requireAuth(req, res) {
  if (!localDev(req) && !isAuthenticated(req)) {
    json(res, 401, { error: "Not authenticated" });
    return false;
  }
  return true;
}

function endpointId(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const action = typeof req.query?.action === "string" ? req.query.action : "";

  try {
    if (!requireAuth(req, res)) return;

    const supabase = getServiceClient();

    if (action === "vapid-key") {
      if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      if (!publicKey) return json(res, 500, { error: "Push notifications are not configured." });
      return json(res, 200, { publicKey });
    }

    if (action === "subscribe") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const body = await readJsonBody(req);
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
      const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
      const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";

      if (!endpoint.startsWith("https://") || !p256dh || !auth) {
        return json(res, 400, { error: "Invalid push subscription." });
      }

      const { error } = await supabase.from("push_subscription").upsert({
        id: endpointId(endpoint),
        endpoint,
        p256dh,
        auth,
        credential_id: getSessionCredentialId(req),
        user_agent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });

      if (error) throw error;
      return json(res, 200, { subscribed: true });
    }

    if (action === "unsubscribe") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const body = await readJsonBody(req);
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
      if (!endpoint) return json(res, 400, { error: "Endpoint is required." });

      const { error } = await supabase.from("push_subscription").delete().eq("endpoint", endpoint);
      if (error) throw error;
      return json(res, 200, { unsubscribed: true });
    }

    if (action === "schedule-reminder") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const body = await readJsonBody(req);
      const reminderId = typeof body?.reminderId === "string" ? body.reminderId.trim() : "";
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const reminderAt = typeof body?.reminderAt === "string" ? body.reminderAt : "";
      const notificationMinutes = Math.max(0, Math.min(10080, Number(body?.notificationMinutes || 0)));
      const recurrence = ["none", "daily", "weekly", "monthly", "yearly"].includes(body?.repeat) ? body.repeat : "none";
      const recurrenceDays = Array.isArray(body?.recurrenceDays) ? body.recurrenceDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
      const recurrenceDay = recurrence === "monthly" ? Math.min(31, Math.max(1, Number(body?.recurrenceDay || 1))) : null;
      if (!reminderId || !title || !reminderAt) return json(res, 400, { error: "Reminder data is incomplete." });
      const reminderDate = new Date(reminderAt);
      if (Number.isNaN(reminderDate.getTime())) return json(res, 400, { error: "Invalid reminder date." });
      const notificationDate = new Date(reminderDate.getTime() - notificationMinutes * 60000);
      if (notificationDate.getTime() <= Date.now()) return json(res, 400, { error: "The phone notification time must be in the future." });
      const storageId = "r:" + reminderId;
      const { error } = await supabase.from("telegram_reminder").upsert({
        id: storageId,
        note_id: reminderId,
        title,
        reminder_at: notificationDate.toISOString(),
        recurrence,
        recurrence_day: recurrenceDay,
        recurrence_days: recurrence === "weekly" ? Array.from(new Set(recurrenceDays)) : [],
        recurrence_interval: null,
        recurrence_unit: null,
        status: "pending",
        sent_at: null,
        locked_at: null,
        attempts: 0,
        last_error: null,
        notify_push: true,
        push_sent_at: null,
      }, { onConflict: "id" });
      if (error) throw error;
      return json(res, 200, { scheduled: true });
    }

    if (action === "cancel-reminder") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const body = await readJsonBody(req);
      const reminderId = typeof body?.reminderId === "string" ? body.reminderId.trim() : "";
      if (!reminderId) return json(res, 400, { error: "Reminder id is required." });
      const id = "r:" + reminderId;
      const { error } = await supabase.from("telegram_reminder").update({
        notify_push: false,
        push_sent_at: null,
      }).eq("id", id);
      if (error) throw error;
      const { data: remaining } = await supabase.from("telegram_reminder").select("notify_telegram").eq("id", id).maybeSingle();
      if (remaining && !remaining.notify_telegram) await supabase.from("telegram_reminder").delete().eq("id", id);
      return json(res, 200, { cancelled: true });
    }

    if (action === "test") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const result = await sendPushToAll(supabase, {
        type: "test",
        title: "Pocket notifications are working",
        body: "This is a test notification from Pocket.",
        url: "/",
        tag: "pocket-test",
      });
      return json(res, 200, { sent: true, result });
    }

    return json(res, 404, { error: "Unknown push action" });
  } catch (error) {
    console.error("Push API error:", error);
    return json(res, 500, { error: error.message || "Push notification failed." });
  }
}
