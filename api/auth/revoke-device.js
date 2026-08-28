import {
  getServiceClient,
  isAuthenticated,
  getSessionCredentialId,
  readJsonBody,
} from "./_utils.js";

function isLocalDevelopment(req) {
  const host = String(req.headers.host || "")
    .split(":")[0]
    .toLowerCase();

  const localHost = host === "localhost" || host === "127.0.0.1";

  const nonProduction = process.env.VERCEL_ENV !== "production";

  return localHost && nonProduction;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const localDev = isLocalDevelopment(req);

    /*
     * Production MUST have a valid
     * authenticated session.
     */
    if (!localDev && !isAuthenticated(req)) {
      res.status(401).json({
        error: "Not authenticated",
      });

      return;
    }

    const body = await readJsonBody(req);

    const credentialId = typeof body.id === "string" ? body.id.trim() : "";

    if (!credentialId) {
      res.status(400).json({
        error: "Device ID is required",
      });

      return;
    }

    /*
     * NEVER allow the currently authenticated
     * credential to revoke itself.
     */
    const currentCredentialId = getSessionCredentialId(req);

    if (
      !localDev &&
      currentCredentialId &&
      credentialId === currentCredentialId
    ) {
      res.status(400).json({
        error: "You cannot revoke the device you are currently using",
      });

      return;
    }

    const supabase = getServiceClient();

    const { data: device, error: lookupError } = await supabase
      .from("webauthn_credential")
      .select("id, device_name, device_type")
      .eq("id", credentialId)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!device) {
      res.status(404).json({
        error: "Device not found",
      });

      return;
    }

    const { error: deleteError } = await supabase
      .from("webauthn_credential")
      .delete()
      .eq("id", credentialId);

    if (deleteError) {
      throw deleteError;
    }

    res.status(200).json({
      revoked: true,

      device: {
        id: device.id,
        deviceName: device.device_name || "Registered device",
        deviceType: device.device_type || "Passkey",
      },
    });
  } catch (e) {
    console.error("revoke-device:", e);

    res.status(500).json({
      error: e.message || "Could not revoke device",
    });
  }
}
