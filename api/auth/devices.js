import { getServiceClient, isAuthenticated } from "./_utils.js";

function isLocalDevelopment(req) {
  const host = String(req.headers.host || "")
    .split(":")[0]
    .toLowerCase();

  const localHost = host === "localhost" || host === "127.0.0.1";

  // Vercel dev does not always behave exactly like a
  // normal Vite development server, so also allow
  // Vercel's non-production environment.
  const nonProduction = process.env.VERCEL_ENV !== "production";

  return localHost && nonProduction;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const localDev = isLocalDevelopment(req);

    /*
     * Production:
     * authentication REQUIRED.
     *
     * Localhost:
     * authentication is intentionally bypassed because
     * LockScreen also bypasses WebAuthn in development.
     */
    if (!localDev && !isAuthenticated(req)) {
      res.status(401).json({
        error: "Not authenticated",
      });
      return;
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("webauthn_credential")
      .select("id, device_name, device_type, created_at, last_used_at")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    res.status(200).json({
      authenticated: localDev ? true : true,
      devices: (data || []).map((device) => ({
        id: device.id,
        deviceName: device.device_name || "Registered device",
        deviceType: device.device_type || "Passkey",
        createdAt: device.created_at,
        lastUsedAt: device.last_used_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/auth/devices:", error);

    res.status(500).json({
      error: error.message || "Could not load devices",
    });
  }
}
