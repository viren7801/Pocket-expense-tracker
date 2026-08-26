import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getServiceClient, RP_ID } from "./_utils.js";

export default async function handler(req, res) {
  try {
    const supabase = getServiceClient();
    const { data: credentials } = await supabase
      .from("webauthn_credential")
      .select("id, transports");

    if (!credentials || credentials.length === 0) {
      res.status(400).json({ error: "No credential registered yet" });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
      allowCredentials: credentials.map((c) => ({
        id: c.id,
        transports: c.transports ? c.transports.split(",") : undefined,
      })),
    });

    await supabase.from("webauthn_challenge").upsert({
      id: "login",
      challenge: options.challenge,
      updated_at: new Date().toISOString(),
    });

    res.status(200).json(options);
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
