import { getServiceClient, isAuthenticated } from "./_utils.js";

export default async function handler(req, res) {
  try {
    const authenticated = isAuthenticated(req);
    const supabase = getServiceClient();
    const { count } = await supabase
      .from("webauthn_credential")
      .select("id", { count: "exact", head: true });

    res.status(200).json({ authenticated, hasCredential: (count || 0) > 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
