import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  getServiceClient,
  isAuthenticated,
  RP_ID,
  readJsonBody,
} from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getServiceClient();
    const { count } = await supabase
      .from("webauthn_credential")
      .select("id", { count: "exact", head: true });

    const alreadySetUp = (count || 0) > 0;
    const authenticated = isAuthenticated(req);

    // Bootstrap: first-ever setup requires the setup code.
    // Adding a second device later requires an existing valid session instead.
    if (!authenticated) {
      const body = await readJsonBody(req).catch(() => ({}));
      const codeOk =
        body.setupCode && body.setupCode === process.env.SETUP_CODE;
      if (alreadySetUp || !codeOk) {
        res
          .status(403)
          .json({ error: "Not authorized to register a new device" });
        return;
      }
    }

    const { data: existing } = await supabase
      .from("webauthn_credential")
      .select("id");

    const options = await generateRegistrationOptions({
      rpName: "Ledger",
      rpID: RP_ID,
      userName: "viren",
      attestationType: "none",
      excludeCredentials: (existing || []).map((c) => ({ id: c.id })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    await supabase.from("webauthn_challenge").upsert({
      id: "register",
      challenge: options.challenge,
      updated_at: new Date().toISOString(),
    });

    res.status(200).json(options);
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
