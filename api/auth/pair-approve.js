import {
  getServiceClient,
  isAuthenticated,
  getSessionCredentialId,
  readJsonBody,
} from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  try {
    if (!isAuthenticated(req)) {
      res.status(401).json({
        error: "Not authenticated",
      });
      return;
    }

    const credentialId = getSessionCredentialId(req);

    const body = await readJsonBody(req);

    const pairingId = typeof body.pairingId === "string" ? body.pairingId : "";

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

    if (pairing.initiator_credential_id !== credentialId) {
      res.status(403).json({
        error: "Not authorized",
      });
      return;
    }

    if (pairing.status !== "pending_approval") {
      res.status(409).json({
        error: "Pairing is not awaiting approval",
      });
      return;
    }

    if (new Date(pairing.expires_at) <= new Date()) {
      res.status(410).json({
        error: "Pairing expired",
      });
      return;
    }

    const { error: updateError } = await supabase
      .from("webauthn_pairing")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
      })
      .eq("id", pairing.id);

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      approved: true,
    });
  } catch (error) {
    console.error("pair-approve:", error);

    res.status(500).json({
      error: error.message || "Could not approve pairing",
    });
  }
}
