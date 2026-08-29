import { verifyRegistrationResponse } from "@simplewebauthn/server";

import {
  getServiceClient,
  ORIGIN,
  RP_ID,
  createSessionToken,
  serializeSessionCookie,
  readJsonBody,
} from "./_utils.js";

import crypto from "node:crypto";

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

    const secret = typeof body.secret === "string" ? body.secret : "";

    const deviceName =
      typeof body.deviceName === "string"
        ? body.deviceName.trim().slice(0, 80)
        : "";

    const deviceType =
      typeof body.deviceType === "string"
        ? body.deviceType.trim().slice(0, 40)
        : "Passkey";

    if (!pairingId || !secret || !deviceName) {
      res.status(400).json({
        error: "Pairing information is incomplete",
      });
      return;
    }

    const supabase = getServiceClient();

    const { data: pairing, error: pairingError } = await supabase
      .from("webauthn_pairing")
      .select("*")
      .eq("id", pairingId)
      .maybeSingle();

    if (pairingError) {
      throw pairingError;
    }

    if (!pairing) {
      res.status(404).json({
        error: "Pairing not found",
      });
      return;
    }

    if (hash(secret) !== pairing.secret_hash) {
      res.status(403).json({
        error: "Invalid pairing secret",
      });
      return;
    }

    if (pairing.status !== "approved") {
      res.status(409).json({
        error: "Device pairing has not been approved",
      });
      return;
    }

    if (new Date(pairing.expires_at) <= new Date()) {
      res.status(410).json({
        error: "Pairing expired",
      });
      return;
    }

    const challengeId = `pair:${pairing.id}`;

    const { data: challengeRow, error: challengeError } = await supabase
      .from("webauthn_challenge")
      .select("challenge")
      .eq("id", challengeId)
      .maybeSingle();

    if (challengeError) {
      throw challengeError;
    }

    if (!challengeRow) {
      res.status(400).json({
        error: "No pending device registration",
      });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: body.registration,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({
        error: "Device verification failed",
      });
      return;
    }

    const { credentialID, credentialPublicKey, counter } =
      verification.registrationInfo;

    const now = new Date().toISOString();

    const { error: insertError } = await supabase
      .from("webauthn_credential")
      .insert({
        id: credentialID,

        public_key: Buffer.from(credentialPublicKey).toString("base64"),

        counter,

        transports: (body.registration?.response?.transports || []).join(","),

        device_name: deviceName,

        device_type: deviceType,

        created_at: now,

        last_used_at: now,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        res.status(409).json({
          error: "This passkey is already registered",
        });
        return;
      }

      throw insertError;
    }

    await supabase.from("webauthn_challenge").delete().eq("id", challengeId);

    await supabase
      .from("webauthn_pairing")
      .update({
        status: "completed",
        completed_at: now,
      })
      .eq("id", pairing.id);

    /*
     * The newly paired device becomes
     * authenticated immediately.
     */
    res.setHeader(
      "Set-Cookie",
      serializeSessionCookie(createSessionToken(credentialID)),
    );

    res.status(200).json({
      verified: true,

      device: {
        id: credentialID,
        deviceName,
        deviceType,
      },
    });
  } catch (error) {
    console.error("pair-complete:", error);

    res.status(500).json({
      error: error.message || "Could not complete device pairing",
    });
  }
}
