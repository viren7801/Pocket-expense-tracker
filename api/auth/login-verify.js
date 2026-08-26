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
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getServiceClient();
    const { data: challengeRow } = await supabase
      .from("webauthn_challenge")
      .select("challenge")
      .eq("id", "login")
      .maybeSingle();

    if (!challengeRow) {
      res.status(400).json({ error: "No pending login challenge" });
      return;
    }

    const body = await readJsonBody(req);

    const { data: credRow } = await supabase
      .from("webauthn_credential")
      .select("*")
      .eq("id", body.id)
      .maybeSingle();

    if (!credRow) {
      res.status(400).json({ error: "Unknown credential" });
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
    });

    if (!verification.verified) {
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    await supabase
      .from("webauthn_credential")
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq("id", credRow.id);

    await supabase.from("webauthn_challenge").delete().eq("id", "login");

    res.setHeader("Set-Cookie", serializeSessionCookie(createSessionToken()));
    res.status(200).json({ verified: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
