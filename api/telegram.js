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

      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

      const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];

      if (!expectedSecret || receivedSecret !== expectedSecret) {
        return json(res, 401, {
          error: "Invalid webhook secret",
        });
      }

      const update = await readJsonBody(req);

      const message = update?.message;

      const messageText =
        typeof message?.text === "string" ? message.text.trim() : "";

      /*
       * We only care about:
       *
       * /start TOKEN
       *
       */
      const match = messageText.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);

      if (!match?.[1]) {
        return json(res, 200, {
          ok: true,
        });
      }

      const token = match[1].trim();

      const supabase = getServiceClient();

      /*
       * Look up the hashed one-time token.
       */
      const { data: link } = await supabase
        .from("telegram_link_token")
        .select("*")
        .eq("token_hash", hash(token))
        .maybeSingle();

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
       * Save the Telegram chat that belongs
       * to the current Pocket account.
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
     * POCKET API REQUESTS
     * =========================================================
     */

    const host = String(req.headers.host || "")
      .split(":")[0]
      .toLowerCase();

    const isLocalDevelopment =
      (host === "localhost" || host === "127.0.0.1") &&
      process.env.VERCEL_ENV !== "production";

    /*
     * In production, require the same Pocket
     * authentication used by the rest of the app.
     *
     * Local development remains usable.
     */
    if (!isLocalDevelopment && !isAuthenticated(req)) {
      return json(res, 401, {
        error: "Not authenticated",
      });
    }

    const supabase = getServiceClient();

    /*
     * =========================================================
     * STATUS
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
     * CREATE TELEGRAM CONNECTION LINK
     * =========================================================
     */
    if (action === "connect") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      /*
       * Tell Telegram where to deliver /start.
       */
      await configureWebhook();

      const botUsername = env("TELEGRAM_BOT_USERNAME");

      /*
       * Remove expired tokens.
       */
      await supabase
        .from("telegram_link_token")
        .delete()
        .lt("expires_at", new Date().toISOString());

      /*
       * Generate a cryptographically random
       * one-time token.
       */
      const token = crypto.randomBytes(32).toString("base64url");

      const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

      const { error } = await supabase.from("telegram_link_token").insert({
        token_hash: hash(token),
        expires_at: expiresAt,
      });

      if (error) {
        throw error;
      }

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
     * DISCONNECT
     * =========================================================
     */
    if (action === "disconnect") {
      if (req.method !== "POST") {
        return json(res, 405, {
          error: "Method not allowed",
        });
      }

      await supabase.from("telegram_connection").delete().eq("id", "main");

      await supabase.from("telegram_link_token").delete();

      return json(res, 200, {
        connected: false,
      });
    }

    /*
     * =========================================================
     * SEND REMINDER
     * =========================================================
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
     * Unknown action.
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
