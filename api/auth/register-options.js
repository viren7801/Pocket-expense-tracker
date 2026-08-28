import { generateRegistrationOptions } from "@simplewebauthn/server";

import {
  getServiceClient,
  isAuthenticated,
  RP_ID,
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

    const authenticated = isAuthenticated(req);

    const { count } = await supabase.from("webauthn_credential").select("id", {
      count: "exact",
      head: true,
    });

    const alreadySetUp = (count || 0) > 0;

    /*
     * First-ever setup:
     * setup code is required.
     *
     * Additional devices:
     * an authenticated Pocket session is required.
     */
    if (!authenticated) {
      const body = await readJsonBody(req).catch(() => ({}));

      const codeOk =
        body.setupCode && body.setupCode === process.env.SETUP_CODE;

      if (alreadySetUp || !codeOk) {
        res.status(403).json({
          error: "Not authorized to register a new device",
        });

        return;
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("webauthn_credential")
      .select("id");

    if (existingError) {
      throw existingError;
    }

    const options = await generateRegistrationOptions({
      rpName: "Pocket",
      rpID: RP_ID,
      userName: "viren",
      userDisplayName: "Viren Patel",

      attestationType: "none",

      excludeCredentials: (existing || []).map((credential) => ({
        id: credential.id,
      })),

      authenticatorSelection: {
        /*
         * REQUIRED means the new credential
         * must be discoverable.
         */
        residentKey: "required",

        userVerification: "required",

        authenticatorAttachment: "platform",
      },
    });

    const { error: challengeError } = await supabase
      .from("webauthn_challenge")
      .upsert({
        id: "register",
        challenge: options.challenge,
        updated_at: new Date().toISOString(),
      });

    if (challengeError) {
      throw challengeError;
    }

    res.status(200).json(options);
  } catch (e) {
    console.error("register-options:", e);

    res.status(500).json({
      error: e.message || "Unknown error",
    });
  }
}
