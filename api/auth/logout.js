import { clearSessionCookie } from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(200).json({ loggedOut: true });
}
