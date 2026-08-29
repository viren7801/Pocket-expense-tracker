import crypto from "node:crypto";

import {
  getServiceClient,
  isAuthenticated,
  getSessionCredentialId,
  readJsonBody,
} from "./_utils.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  try {
    if (!isAuthenticated(req)) {
      res.status(401).json({
        error: "Not authenticated",
      });
      return;
    }

    const credentialId = getSessionCredentialId(req);

    if (!credentialId) {
      res.status(401).json({
        error: "Session is not bound to a device",
      });
      return;
    }

    const body = await readJsonBody(req);
    const deviceName =
      typeof body.deviceName === "string"
        ? body.deviceName.trim().slice(0, 80)
        : "";

    const deviceType =
      typeof body.deviceType === "string"
        ? body.deviceType.trim().slice(0, 40)
        : "Passkey";

    if (!deviceName) {
      res.status(400).json({
        error: "Device name is required",
      });
      return;
    }

    const supabase = getServiceClient();

    /*
     * Remove expired pairings belonging to this
     * authenticated device.
     */
    await supabase
      .from("webauthn_pairing")
      .delete()
      .eq("initiator_credential_id", credentialId)
      .lt("expires_at", new Date().toISOString());

    const id = crypto.randomUUID();

    const code = createCode();

    const secret = crypto.randomBytes(32).toString("base64url");

    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

    const { error } = await supabase.from("webauthn_pairing").insert({
      id,
      code_hash: hash(code),
      secret_hash: hash(secret),
      initiator_credential_id: credentialId,
      status: "waiting",
      requested_device_name: deviceName,
      requested_device_type: deviceType,
      expires_at: expiresAt,
    });

    if (error) {
      throw error;
    }

    res.status(200).json({
      pairingId: id,
      code,
      secret,
      expiresAt,
    });
  } catch (error) {
    console.error("pair-start:", error);

    res.status(500).json({
      error: error.message || "Could not create pairing",
    });
  }
}
