import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getServiceClient, RP_ID } from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const supabase = getServiceClient();

    const { count, error } = await supabase
      .from("webauthn_credential")
      .select("id", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    if ((count || 0) === 0) {
      res.status(400).json({
        error: "No credential registered yet",
      });
      return;
    }

    /*
     * IMPORTANT:
     *
     * We intentionally do NOT send an allowCredentials list.
     *
     * This makes authentication discoverable:
     * the authenticator/browser can offer any
     * discoverable Pocket passkey for this RP.
     *
     * The selected credential is still verified
     * against Supabase by login-verify.js.
     */
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
    });

    await supabase.from("webauthn_challenge").upsert({
      id: "login",
      challenge: options.challenge,
      updated_at: new Date().toISOString(),
    });

    res.status(200).json(options);
  } catch (e) {
    console.error("login-options:", e);

    res.status(500).json({
      error: e.message || "Unknown error",
    });
  }
}
