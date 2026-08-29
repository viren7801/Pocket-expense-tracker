import crypto from "node:crypto";

import { getServiceClient, readJsonBody } from "./_utils.js";

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const body = await readJsonBody(req);

    const code =
      typeof body.code === "string"
        ? body.code.trim().replace(/\s/g, "").toUpperCase()
        : "";

    const deviceName =
      typeof body.deviceName === "string"
        ? body.deviceName.trim().slice(0, 80)
        : "";

    const deviceType =
      typeof body.deviceType === "string"
        ? body.deviceType.trim().slice(0, 40)
        : "Passkey";

    if (!code) {
      res.status(400).json({
        error: "Pairing code is required",
      });
      return;
    }

    if (!deviceName) {
      res.status(400).json({
        error: "Device name is required",
      });
      return;
    }

    const supabase = getServiceClient();

    /*
     * Find the pairing record using the hashed
     * one-time pairing code.
     */
    const { data: pairing, error: lookupError } = await supabase
      .from("webauthn_pairing")
      .select("*")
      .eq("code_hash", hash(code))
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!pairing) {
      res.status(404).json({
        error: "Invalid or expired pairing code",
      });
      return;
    }

    /*
     * Pairing codes are short-lived.
     */
    if (new Date(pairing.expires_at) <= new Date()) {
      await supabase
        .from("webauthn_pairing")
        .update({
          status: "expired",
        })
        .eq("id", pairing.id);

      res.status(410).json({
        error: "This pairing code has expired",
      });
      return;
    }

    /*
     * The code can only be used once.
     */
    if (pairing.status !== "waiting") {
      res.status(409).json({
        error: "This pairing code has already been used",
      });
      return;
    }

    /*
     * Generate a second secret used by the new
     * device for the remainder of the pairing flow.
     *
     * We never send the stored hash to the browser.
     */
    const secret = crypto.randomBytes(32).toString("base64url");

    const { error: updateError } = await supabase
      .from("webauthn_pairing")
      .update({
        status: "pending_approval",

        secret_hash: hash(secret),

        requested_device_name: deviceName,

        requested_device_type: deviceType,
      })
      .eq("id", pairing.id);

    if (updateError) {
      throw updateError;
    }

    /*
     * The secret is returned only to the device
     * that entered the pairing code.
     */
    res.status(200).json({
      pairingId: pairing.id,

      secret,

      status: "pending_approval",

      deviceName,

      deviceType,

      expiresAt: pairing.expires_at,
    });
  } catch (error) {
    console.error("pair-request:", error);

    res.status(500).json({
      error: error.message || "Could not request pairing",
    });
  }
}
