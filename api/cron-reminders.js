import crypto from "node:crypto";

function json(res, status, body) {
  res.status(status).json(body);
}

function constantTimeMatches(provided, expected) {
  if (typeof provided !== "string" || !expected) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return "";
  }

  return authorization.slice(7).trim();
}

function getBaseUrl(req) {
  const host = String(req.headers.host || "").trim();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();

  const protocol =
    forwardedProto || (process.env.VERCEL_ENV ? "https" : "http");

  if (!host) {
    throw new Error("Could not determine the Pocket deployment host.");
  }

  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    /*
     * Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
     * TELEGRAM_CRON_SECRET is kept as the fallback so the existing
     * Telegram worker remains compatible with the current setup.
     */
    const bearer = getBearerToken(req);
    const expectedSecrets = [
      process.env.CRON_SECRET,
      process.env.TELEGRAM_CRON_SECRET,
    ].filter(Boolean);

    const authorized = expectedSecrets.some((secret) =>
      constantTimeMatches(bearer, secret),
    );

    if (!authorized) {
      return json(res, 401, { error: "Invalid cron secret" });
    }

    const workerSecret = process.env.TELEGRAM_CRON_SECRET;

    if (!workerSecret) {
      return json(res, 500, {
        error: "Missing TELEGRAM_CRON_SECRET environment variable",
      });
    }

    const response = await fetch(
      `${getBaseUrl(req)}/api/telegram?action=process-reminders`,
      {
        method: "POST",
        headers: {
          "x-telegram-cron-secret": workerSecret,
        },
      },
    );

    const text = await response.text();
    let body;

    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    return json(res, response.status, {
      ok: response.ok,
      ...body,
    });
  } catch (error) {
    console.error("Reminder cron error:", error);

    return json(res, 500, {
      error: error.message || "Reminder cron failed",
    });
  }
}
