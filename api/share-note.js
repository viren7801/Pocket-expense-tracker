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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

      // Revoke requests are recognized from the body first. This avoids
      // relying on query-string parsing and prevents them from falling
      // through into share creation.
      if (body?.shareId && body?.managementToken) {
        const action = String(body?.action || "revoke");

        const shareId = String(body.shareId);

        const managementToken = String(body.managementToken);

        const { data, error: lookupError } = await supabase
          .from("note_shares")
          .select("id, management_token_hash, revoked")
          .eq("id", shareId)
          .maybeSingle();

        if (lookupError) {
          throw lookupError;
        }

        if (!data) {
          return json(res, 404, {
            error: "Share link not found.",
          });
        }

        if (!data.management_token_hash) {
          return json(res, 409, {
            error:
              "This share was created before share management was enabled. Create a new share link.",
          });
        }

        if (data.management_token_hash !== hash(managementToken)) {
          return json(res, 403, {
            error: "Invalid share management token.",
          });
        }

        if (data.revoked) {
          return json(res, 200, {
            revoked: true,
          });
        }

        const { error: revokeError } = await supabase
          .from("note_shares")
          .update({
            revoked: true,
            revoked_at: new Date().toISOString(),
          })
          .eq("id", shareId);

        if (revokeError) {
          throw revokeError;
        }

        return json(res, 200, {
          revoked: true,
        });
      }

      // Otherwise this is a new encrypted share.
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

      const managementToken = crypto.randomBytes(32).toString("base64url");

      const expiresAt = expirationDate(body?.expiresIn);

      const { error } = await supabase.from("note_shares").insert({
        id: shareId,

        owner_id: null,

        management_token_hash: hash(managementToken),

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
        managementToken,
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

    if (req.method === "POST" && String(req.query?.action || "") === "revoke") {
      const body = await readJsonBody(req);

      const shareId = String(body?.shareId || "");

      const managementToken = String(body?.managementToken || "");

      if (!shareId || !managementToken) {
        return json(res, 400, {
          error: "Share id and management token are required.",
        });
      }

      const { data, error: lookupError } = await supabase
        .from("note_shares")
        .select("id, management_token_hash, revoked")
        .eq("id", shareId)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (!data) {
        return json(res, 404, {
          error: "Share link not found.",
        });
      }

      if (!data.management_token_hash) {
        return json(res, 409, {
          error:
            "This share was created before share management was enabled. Create a new share link.",
        });
      }

      if (data.management_token_hash !== hash(managementToken)) {
        return json(res, 403, {
          error: "Invalid share management token.",
        });
      }

      if (action === "delete") {
        if (!data.revoked) {
          return json(res, 409, {
            error: "Only revoked share links can be permanently removed.",
          });
        }

        const { error: deleteError } = await supabase
          .from("note_shares")
          .delete()
          .eq("id", shareId);

        if (deleteError) {
          throw deleteError;
        }

        return json(res, 200, {
          deleted: true,
        });
      }

      const { error: revokeError } = await supabase
        .from("note_shares")
        .update({
          revoked: true,
          revoked_at: new Date().toISOString(),
        })
        .eq("id", shareId);

      if (revokeError) {
        throw revokeError;
      }

      return json(res, 200, {
        revoked: true,
      });
    }

    if (req.method === "GET" && String(req.query?.action || "") === "manage") {
      const shareId = String(req.query?.id || "");

      const managementToken = String(req.query?.token || "");

      if (!shareId || !managementToken) {
        return json(res, 400, {
          error: "Share id and management token are required.",
        });
      }

      const { data, error: lookupError } = await supabase
        .from("note_shares")
        .select("id, management_token_hash, expires_at, revoked")
        .eq("id", shareId)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (!data || data.management_token_hash !== hash(managementToken)) {
        return json(res, 403, {
          error: "Invalid share management token.",
        });
      }

      return json(res, 200, {
        shareId: data.id,
        expiresAt: data.expires_at,
        revoked: data.revoked,
      });
    }

    if (req.method === "DELETE") {
      return json(res, 501, {
        error: "Use POST ?action=revoke with the management token.",
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
