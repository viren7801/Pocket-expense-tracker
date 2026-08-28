import { verifyAuthenticationResponse } from "@simplewebauthn/server";

import {
  getServiceClient,
  ORIGIN,
  RP_ID,
  createSessionToken,
  serializeSessionCookie,
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
      .eq("id", "login")
      .maybeSingle();

    if (challengeError) {
      throw challengeError;
    }

    if (!challengeRow?.challenge) {
      res.status(400).json({
        code: "NO_LOGIN_CHALLENGE",
        error: "No pending login challenge",
      });
      return;
    }

    const body = await readJsonBody(req);

    const credentialId = typeof body.id === "string" ? body.id.trim() : "";

    if (!credentialId) {
      res.status(400).json({
        code: "INVALID_CREDENTIAL",
        error: "Invalid passkey",
      });
      return;
    }

    /*
     * Look up the credential in our database.
     *
     * If it isn't there, it may be a passkey that was
     * revoked/deleted on the server but still exists
     * in the phone's/password manager's local store.
     */
    const { data: credRow, error: credentialLookupError } = await supabase
      .from("webauthn_credential")
      .select("*")
      .eq("id", credentialId)
      .maybeSingle();

    if (credentialLookupError) {
      throw credentialLookupError;
    }

    if (!credRow) {
      /*
       * Do not reveal whether this credential ever existed.
       *
       * The client can use this generic server-side state
       * to tell the authenticator that the selected credential
       * is no longer accepted by Pocket.
       */
      res.status(404).json({
        code: "CREDENTIAL_NOT_REGISTERED",
        error: "This passkey is no longer registered with Pocket.",
      });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,

      authenticator: {
        credentialID: credRow.id,

        credentialPublicKey: Buffer.from(credRow.public_key, "base64"),

        counter: credRow.counter,

        transports: credRow.transports
          ? credRow.transports.split(",")
          : undefined,
      },

      requireUserVerification: true,
    });

    if (!verification.verified) {
      res.status(400).json({
        code: "VERIFICATION_FAILED",
        error: "Passkey verification failed",
      });
      return;
    }

    const newCounter = verification.authenticationInfo.newCounter;

    const { error: updateError } = await supabase
      .from("webauthn_credential")
      .update({
        counter: newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", credRow.id);

    if (updateError) {
      throw updateError;
    }

    await supabase.from("webauthn_challenge").delete().eq("id", "login");

    const sessionToken = createSessionToken(credRow.id);

    res.setHeader("Set-Cookie", serializeSessionCookie(sessionToken));

    res.status(200).json({
      verified: true,

      device: {
        id: credRow.id,

        deviceName: credRow.device_name || "Registered device",

        deviceType: credRow.device_type || "Passkey",
      },
    });
  } catch (e) {
    console.error("login-verify:", e);

    res.status(500).json({
      code: "LOGIN_ERROR",
      error: e.message || "Unknown error",
    });
  }
}
