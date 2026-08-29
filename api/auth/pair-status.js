import crypto from "node:crypto";

import {
  getServiceClient,
  isAuthenticated,
  getSessionCredentialId,
  readJsonBody,
} from "./_utils.js";

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

  try {
    const body = await readJsonBody(req);

    const pairingId = typeof body.pairingId === "string" ? body.pairingId : "";

    if (!pairingId) {
      res.status(400).json({
        error: "Pairing ID is required",
      });
      return;
    }

    const supabase = getServiceClient();

    const { data: pairing, error } = await supabase
      .from("webauthn_pairing")
      .select("*")
      .eq("id", pairingId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!pairing) {
      res.status(404).json({
        error: "Pairing not found",
      });
      return;
    }

    if (new Date(pairing.expires_at) <= new Date()) {
      res.status(410).json({
        error: "Pairing expired",
      });
      return;
    }

    /*
     * New device request.
     */
    if (body.secret) {
      if (hash(body.secret) !== pairing.secret_hash) {
        res.status(403).json({
          error: "Invalid pairing secret",
        });
        return;
      }

      res.status(200).json({
        role: "new_device",
        status: pairing.status,
        deviceName: pairing.requested_device_name,
        deviceType: pairing.requested_device_type,
        expiresAt: pairing.expires_at,
      });

      return;
    }

    /*
     * Trusted device.
     */
    if (!isAuthenticated(req)) {
      res.status(401).json({
        error: "Not authenticated",
      });
      return;
    }

    const credentialId = getSessionCredentialId(req);

    if (!credentialId || credentialId !== pairing.initiator_credential_id) {
      res.status(403).json({
        error: "Not authorized",
      });
      return;
    }

    res.status(200).json({
      role: "trusted_device",
      status: pairing.status,
      deviceName: pairing.requested_device_name,
      deviceType: pairing.requested_device_type,
      expiresAt: pairing.expires_at,
    });
  } catch (error) {
    console.error("pair-status:", error);

    res.status(500).json({
      error: error.message || "Could not read pairing status",
    });
  }
}
