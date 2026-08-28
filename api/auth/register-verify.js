import { verifyRegistrationResponse } from "@simplewebauthn/server";

import {
  getServiceClient,
  ORIGIN,
  RP_ID,
  createSessionToken,
  serializeSessionCookie,
  isAuthenticated,
  readJsonBody,
} from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const supabase = getServiceClient();

    const { data: challengeRow, error: challengeError } = await supabase
      .from("webauthn_challenge")
      .select("challenge")
      .eq("id", "register")
      .maybeSingle();

    if (challengeError) {
      throw challengeError;
    }

    if (!challengeRow?.challenge) {
      res.status(400).json({
        error: "No pending registration challenge",
      });
      return;
    }

    const body = await readJsonBody(req);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({
        error: "Verification failed",
      });
      return;
    }

    const { credentialID, credentialPublicKey, counter } =
      verification.registrationInfo;

    const deviceName =
      typeof body.deviceName === "string" && body.deviceName.trim()
        ? body.deviceName.trim().slice(0, 80)
        : "New device";

    const deviceType =
      typeof body.deviceType === "string" && body.deviceType.trim()
        ? body.deviceType.trim().slice(0, 40)
        : "Passkey";

    const { error: insertError } = await supabase
      .from("webauthn_credential")
      .insert({
        id: credentialID,

        public_key: Buffer.from(credentialPublicKey).toString("base64"),

        counter,

        transports: (body.response?.transports || []).join(","),

        device_name: deviceName,

        device_type: deviceType,

        created_at: new Date().toISOString(),

        last_used_at: new Date().toISOString(),
      });

    if (insertError) {
      if (insertError.code === "23505") {
        res.status(409).json({
          error: "This device is already registered",
        });

        return;
      }

      throw insertError;
    }

    await supabase.from("webauthn_challenge").delete().eq("id", "register");

    /*
     * First-ever setup:
     * create a session for the newly
     * registered credential.
     *
     * Adding another device while already
     * logged in:
     * DO NOT replace the existing session.
     */
    if (!isAuthenticated(req)) {
      res.setHeader(
        "Set-Cookie",
        serializeSessionCookie(createSessionToken(credentialID)),
      );
    }

    res.status(200).json({
      verified: true,

      device: {
        id: credentialID,
        deviceName,
        deviceType,
      },
    });
  } catch (e) {
    console.error("register-verify:", e);

    res.status(500).json({
      error: e.message || "Unknown error",
    });
  }
}
