import { verifyRegistrationResponse } from "@simplewebauthn/server";
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
      .eq("id", "register")
      .maybeSingle();

    if (!challengeRow) {
      res.status(400).json({ error: "No pending registration challenge" });
      return;
    }

    const body = await readJsonBody(req);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    const { credentialID, credentialPublicKey, counter } =
      verification.registrationInfo;

    await supabase.from("webauthn_credential").insert({
      id: credentialID,
      public_key: Buffer.from(credentialPublicKey).toString("base64"),
      counter,
      transports: (body.response.transports || []).join(","),
    });

    await supabase.from("webauthn_challenge").delete().eq("id", "register");

    res.setHeader("Set-Cookie", serializeSessionCookie(createSessionToken()));
    res.status(200).json({ verified: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
