import crypto from "node:crypto";

import { generateRegistrationOptions } from "@simplewebauthn/server";

import { getServiceClient, RP_ID, readJsonBody } from "./_utils.js";

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

    if (!pairingId || !secret) {
      res.status(400).json({
        error: "Pairing credentials are required",
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

    if (hash(secret) !== pairing.secret_hash) {
      res.status(403).json({
        error: "Invalid pairing secret",
      });
      return;
    }

    if (pairing.status !== "approved") {
      res.status(409).json({
        error: "The trusted device has not approved this device yet",
      });
      return;
    }

    if (new Date(pairing.expires_at) <= new Date()) {
      res.status(410).json({
        error: "Pairing expired",
      });
      return;
    }

    const { data: credentials, error: credentialsError } = await supabase
      .from("webauthn_credential")
      .select("id");

    if (credentialsError) {
      throw credentialsError;
    }

    const options = await generateRegistrationOptions({
      rpName: "Pocket",
      rpID: RP_ID,

      userName: "viren",
      userDisplayName: "Viren Patel",

      attestationType: "none",

      excludeCredentials: (credentials || []).map((credential) => ({
        id: credential.id,
      })),

      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    const challengeId = `pair:${pairing.id}`;

    const { error: challengeError } = await supabase
      .from("webauthn_challenge")
      .upsert({
        id: challengeId,
        challenge: options.challenge,
        updated_at: new Date().toISOString(),
      });

    if (challengeError) {
      throw challengeError;
    }

    res.status(200).json(options);
  } catch (error) {
    console.error("pair-options:", error);

    res.status(500).json({
      error: error.message || "Could not create pairing options",
    });
  }
}
