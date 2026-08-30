import crypto from "node:crypto";
import {
  getServiceClient,
  isAuthenticated,
  readJsonBody,
} from "./auth/_utils.js";

const json = (res, status, body) => res.status(status).json(body);

function base64UrlToBuffer(value) {
  return Buffer.from(
    String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(String(value || "").length / 4) * 4, "="),
    "base64",
  );
}

function base64UrlFromBuffer(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function expirationDate(value) {
  const now = Date.now();

  const durations = {
    never: null,
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };

  const duration = Object.prototype.hasOwnProperty.call(durations, value)
    ? durations[value]
    : null;

  return duration === null ? null : new Date(now + duration).toISOString();
}

export default async function handler(req, res) {
  try {
    const supabase = getServiceClient();

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      const ciphertext = String(body?.ciphertext || "");

      const iv = String(body?.iv || "");

      if (!ciphertext || !iv) {
        return json(res, 400, {
          error: "Encrypted share data is required.",
        });
      }

      if (ciphertext.length > 2000000 || iv.length > 1000) {
        return json(res, 413, {
          error: "Share payload is too large.",
        });
      }

      const shareId = crypto.randomUUID();

      const expiresAt = expirationDate(body?.expiresIn);

      const { error } = await supabase.from("note_shares").insert({
        id: shareId,

        owner_id: null,

        ciphertext,

        iv,

        permission: "read-only",

        expires_at: expiresAt,

        revoked: false,
      });

      if (error) {
        throw error;
      }

      return json(res, 200, {
        shareId,
        expiresAt,
      });
    }

    if (req.method === "GET") {
      const shareId = String(req.query?.id || "");

      if (!shareId) {
        return json(res, 400, {
          error: "Share id is required.",
        });
      }

      const { data, error } = await supabase
        .from("note_shares")
        .select("ciphertext, iv, permission, expires_at, revoked")
        .eq("id", shareId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data || data.revoked) {
        return json(res, 404, {
          error: "This share link is no longer available.",
        });
      }

      if (
        data.expires_at &&
        new Date(data.expires_at).getTime() <= Date.now()
      ) {
        return json(res, 410, {
          error: "This share link has expired.",
        });
      }

      return json(res, 200, {
        ciphertext: data.ciphertext,

        iv: data.iv,

        permission: data.permission,

        expiresAt: data.expires_at,
      });
    }

    if (req.method === "DELETE") {
      const user = await isAuthenticated(req);

      if (!user) {
        return json(res, 401, {
          error: "Authentication required.",
        });
      }

      const shareId = String(req.query?.id || "");

      if (!shareId) {
        return json(res, 400, {
          error: "Share id is required.",
        });
      }

      const { error } = await supabase
        .from("note_shares")
        .update({
          revoked: true,
          revoked_at: new Date().toISOString(),
        })
        .eq("id", shareId)
        .eq("owner_id", user.id);

      if (error) {
        throw error;
      }

      return json(res, 200, {
        revoked: true,
      });
    }

    return json(res, 405, {
      error: "Method not allowed.",
    });
  } catch (error) {
    console.error("Share API error:", error);

    return json(res, 500, {
      error: "Could not process share request.",
    });
  }
}
