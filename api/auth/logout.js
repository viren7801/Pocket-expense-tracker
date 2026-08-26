import { clearSessionCookie } from "./_utils.js";

export default async function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(200).json({ loggedOut: true });
}
