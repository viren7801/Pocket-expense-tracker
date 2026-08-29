import crypto from "node:crypto";
import {
  getServiceClient,
  isAuthenticated,
  readJsonBody,
  ORIGIN,
} from "./auth/_utils.js";

const LINK_TTL_MS = 10 * 60 * 1000;

const json = (res, status, body) => res.status(status).json(body);

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function env(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function cronAuthorized(req) {
  const expected = process.env.TELEGRAM_CRON_SECRET;

  const provided = req.headers["x-telegram-cron-secret"];

  if (
    !expected ||
    typeof provided !== "string" ||
    provided.length !== expected.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

async function telegramRequest(method, payload) {
  const token = env("TELEGRAM_BOT_TOKEN");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }

  return data.result;
}

async function configureWebhook() {
  const secret = env("TELEGRAM_WEBHOOK_SECRET");

  await telegramRequest("setWebhook", {
    url: `${ORIGIN}/api/telegram?action=webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const action = typeof req.query?.action === "string" ? req.query.action : "";

  try {
    /*
     * =========================================================
     * TELEGRAM WEBHOOK
     * =========================================================
     *
     * Telegram calls this endpoint when the user
     * presses /start on the Pocket bot.
     */
    if (action === "webhook") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      const expected = process.env.TELEGRAM_WEBHOOK_SECRET;

      const received = req.headers["x-telegram-bot-api-secret-token"];

      if (!expected || received !== expected) {
        return json(res, 401, {
          error: "Invalid webhook secret",
        });
      }

      const update = await readJsonBody(req);

      const message = update?.message;

      const messageText =
        typeof message?.text === "string" ? message.text.trim() : "";

      const match = messageText.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);

      if (!match?.[1]) {
        return json(res, 200, {
          ok: true,
        });
      }

      const token = match[1].trim();

      const supabase = getServiceClient();

      /*
       * Find the one-time connection token.
       */
      const { data: link } = await supabase
        .from("telegram_link_token")
        .select("*")
        .eq("token_hash", hash(token))
        .maybeSingle();

      /*
       * Token missing, already used,
       * or expired.
       */
      if (
        !link ||
        link.used_at ||
        new Date(link.expires_at).getTime() <= Date.now()
      ) {
        await telegramRequest("sendMessage", {
          chat_id: message.chat.id,
          text: "This Pocket connection link has expired. Start the Telegram connection again from Pocket.",
        });

        return json(res, 200, {
          ok: true,
        });
      }

      /*
       * Store the Telegram chat.
       */
      const { error: connectionError } = await supabase
        .from("telegram_connection")
        .upsert(
          {
            id: "main",

            chat_id: String(message.chat.id),

            username: message.from?.username || null,

            first_name: message.from?.first_name || null,

            connected_at: new Date().toISOString(),
          },
          {
            onConflict: "id",
          },
        );

      if (connectionError) {
        throw connectionError;
      }

      /*
       * One-time token cannot be reused.
       */
      await supabase
        .from("telegram_link_token")
        .update({
          used_at: new Date().toISOString(),
        })
        .eq("id", link.id);

      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,

        text: "✅ Pocket is now connected. Telegram-selected Notes reminders will be sent to this chat.",
      });

      return json(res, 200, {
        ok: true,
      });
    }

    /*
     * =========================================================
     * BACKGROUND TELEGRAM REMINDER WORKER
     * =========================================================
     *
     * Supabase Cron calls this every minute.
     */
    if (action === "process-reminders") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      /*
       * Only the scheduler should be allowed
       * to call this endpoint.
       */
      if (!cronAuthorized(req)) {
        return json(res, 401, {
          error: "Invalid cron secret",
        });
      }

      const supabase = getServiceClient();

      const now = new Date().toISOString();

      /*
       * If a worker crashed while processing
       * a reminder, allow another worker to
       * recover it after 10 minutes.
       */
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      /*
       * Find reminders that are due.
       */
      const { data: reminders, error: reminderQueryError } = await supabase
        .from("telegram_reminder")
        .select("id, note_id, title, reminder_at, status, locked_at, attempts")
        .lte("reminder_at", now)
        .or(
          `status.eq.pending,and(status.eq.processing,locked_at.lt.${cutoff})`,
        )
        .order("reminder_at", {
          ascending: true,
        })
        .limit(20);

      if (reminderQueryError) {
        throw reminderQueryError;
      }

      let sent = 0;
      let failed = 0;

      /*
       * Process reminders one by one.
       */
      for (const reminder of reminders || []) {
        /*
         * Claim the reminder so two workers
         * don't send it at the same time.
         */
        const { data: claimed, error: claimError } = await supabase
          .from("telegram_reminder")
          .update({
            status: "processing",

            locked_at: new Date().toISOString(),

            attempts: Number(reminder.attempts || 0) + 1,

            last_error: null,
          })
          .eq("id", reminder.id)
          .or(
            `status.eq.pending,and(status.eq.processing,locked_at.lt.${cutoff})`,
          )
          .select("id")
          .maybeSingle();

        if (claimError || !claimed) {
          continue;
        }

        try {
          /*
           * Find connected Telegram chat.
           */
          const { data: connection } = await supabase
            .from("telegram_connection")
            .select("chat_id")
            .eq("id", "main")
            .maybeSingle();

          if (!connection?.chat_id) {
            throw new Error("Telegram is not connected.");
          }

          /*
           * Send the reminder.
           */
          await telegramRequest("sendMessage", {
            chat_id: connection.chat_id,

            text: `🔔 Pocket Notes reminder\n\n${reminder.title}`,
          });

          /*
           * Mark it as sent.
           */
          await supabase
            .from("telegram_reminder")
            .update({
              status: "sent",

              sent_at: new Date().toISOString(),

              locked_at: null,

              last_error: null,
            })
            .eq("id", reminder.id);

          sent += 1;
        } catch (sendError) {
          /*
           * Put it back into pending state so
           * the next scheduler run can retry it.
           */
          await supabase
            .from("telegram_reminder")
            .update({
              status: "pending",

              locked_at: null,

              last_error: String(sendError.message || sendError).slice(0, 1000),
            })
            .eq("id", reminder.id);

          failed += 1;
        }
      }

      return json(res, 200, {
        ok: true,

        checked: reminders?.length || 0,

        sent,

        failed,
      });
    }

    /*
     * =========================================================
     * POCKET BROWSER AUTH
     * =========================================================
     */

    const host = String(req.headers.host || "")
      .split(":")[0]
      .toLowerCase();

    const isLocalDevelopment =
      (host === "localhost" || host === "127.0.0.1") &&
      process.env.VERCEL_ENV !== "production";

    if (!isLocalDevelopment && !isAuthenticated(req)) {
      return json(res, 401, {
        error: "Not authenticated",
      });
    }

    const supabase = getServiceClient();

    /*
     * =========================================================
     * TELEGRAM STATUS
     * =========================================================
     */
    if (action === "status") {
      if (req.method !== "GET") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      const { data: connection } = await supabase
        .from("telegram_connection")
        .select("username, first_name, connected_at")
        .eq("id", "main")
        .maybeSingle();

      return json(res, 200, {
        connected: Boolean(connection),

        username: connection?.username || "",

        firstName: connection?.first_name || "",

        connectedAt: connection?.connected_at || null,
      });
    }

    /*
     * =========================================================
     * START TELEGRAM CONNECTION
     * =========================================================
     */
    if (action === "connect") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      /*
       * Configure Telegram webhook.
       */
      await configureWebhook();

      const botUsername = env("TELEGRAM_BOT_USERNAME");

      /*
       * Delete old expired tokens.
       */
      await supabase
        .from("telegram_link_token")
        .delete()
        .lt("expires_at", new Date().toISOString());

      /*
       * Cryptographically random token.
       */
      const token = crypto.randomBytes(32).toString("base64url");

      const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

      /*
       * Store only the token hash.
       */
      const { error } = await supabase.from("telegram_link_token").insert({
        token_hash: hash(token),

        expires_at: expiresAt,
      });

      if (error) {
        throw error;
      }

      /*
       * Telegram deep link.
       */
      const url = `https://t.me/${botUsername}?start=${encodeURIComponent(
        token,
      )}`;

      return json(res, 200, {
        url,
        expiresAt,
      });
    }

    /*
     * =========================================================
     * DISCONNECT TELEGRAM
     * =========================================================
     */
    if (action === "disconnect") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      await supabase.from("telegram_connection").delete().eq("id", "main");

      /*
       * Remove all scheduled Telegram
       * reminders when Telegram is disconnected.
       */
      await supabase.from("telegram_reminder").delete().neq("id", "");

      return json(res, 200, {
        connected: false,
      });
    }

    /*
     * =========================================================
     * SCHEDULE TELEGRAM REMINDER
     * =========================================================
     */
    if (action === "schedule-reminder") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      const body = await readJsonBody(req);

      const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";

      const title = typeof body.title === "string" ? body.title.trim() : "";

      const reminderAt =
        typeof body.reminderAt === "string" ? body.reminderAt : "";

      if (!noteId || !title || !reminderAt) {
        return json(res, 400, {
          error: "Note reminder data is incomplete",
        });
      }

      const reminderDate = new Date(reminderAt);

      if (Number.isNaN(reminderDate.getTime())) {
        return json(res, 400, {
          error: "Invalid reminder date",
        });
      }

      if (reminderDate.getTime() <= Date.now()) {
        return json(res, 400, {
          error: "Choose a future reminder time",
        });
      }

      /*
       * Confirm Telegram is connected.
       */
      const { data: connection } = await supabase
        .from("telegram_connection")
        .select("chat_id")
        .eq("id", "main")
        .maybeSingle();

      if (!connection?.chat_id) {
        return json(res, 409, {
          error: "Telegram is not connected",
        });
      }

      /*
       * Upsert means editing the reminder
       * updates the existing schedule instead
       * of creating duplicates.
       */
      const { data: reminder, error } = await supabase
        .from("telegram_reminder")
        .upsert(
          {
            id: noteId,

            note_id: noteId,

            title,

            reminder_at: reminderDate.toISOString(),

            status: "pending",

            sent_at: null,

            locked_at: null,

            attempts: 0,

            last_error: null,
          },
          {
            onConflict: "id",
          },
        )
        .select("id, note_id, title, reminder_at, status")
        .single();

      if (error) {
        throw error;
      }

      return json(res, 200, {
        scheduled: true,
        reminder,
      });
    }

    /*
     * =========================================================
     * CANCEL TELEGRAM REMINDER
     * =========================================================
     */
    if (action === "cancel-reminder") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      const body = await readJsonBody(req);

      const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";

      if (!noteId) {
        return json(res, 400, {
          error: "Note id is required",
        });
      }

      const { error } = await supabase
        .from("telegram_reminder")
        .delete()
        .eq("id", noteId);

      if (error) {
        throw error;
      }

      return json(res, 200, {
        cancelled: true,
      });
    }

    /*
     * =========================================================
     * MANUAL SEND REMINDER
     * =========================================================
     *
     * Kept for compatibility/testing.
     */
    if (action === "send-reminder") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      const body = await readJsonBody(req);

      const title = typeof body.title === "string" ? body.title.trim() : "";

      const noteId = typeof body.noteId === "string" ? body.noteId : "";

      if (!title || !noteId) {
        return json(res, 400, {
          error: "Note reminder data is incomplete",
        });
      }

      const { data: connection } = await supabase
        .from("telegram_connection")
        .select("chat_id")
        .eq("id", "main")
        .maybeSingle();

      if (!connection?.chat_id) {
        return json(res, 409, {
          error: "Telegram is not connected",
        });
      }

      await telegramRequest("sendMessage", {
        chat_id: connection.chat_id,

        text: `🔔 Pocket Notes reminder\n\n${title}`,
      });

      return json(res, 200, {
        sent: true,
      });
    }

    /*
     * =========================================================
     * UNKNOWN ACTION
     * =========================================================
     */
    return json(res, 404, {
      error: "Unknown Telegram action",
    });
  } catch (error) {
    console.error("Telegram API error:", error);

    return json(res, 500, {
      error: error.message || "Telegram integration failed",
    });
  }
}
