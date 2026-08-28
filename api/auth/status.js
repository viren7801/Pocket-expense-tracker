import { getServiceClient, isAuthenticated } from "./_utils.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const authenticated = isAuthenticated(req);
    const supabase = getServiceClient();

    const { count, error } = await supabase
      .from("webauthn_credential")
      .select("id", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    res.status(200).json({
      authenticated,
      hasCredential: (count || 0) > 0,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message || "Unknown error",
    });
  }
}
