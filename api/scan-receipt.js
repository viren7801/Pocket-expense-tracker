// Vercel serverless function — runs server-side only.
// The API key lives in a Vercel environment variable and is never sent
// to, or readable by, the browser.

const PROMPT = `You are reading a photo of a purchase receipt or an online order confirmation.
Extract the following and respond with ONLY raw JSON, no markdown fences, no commentary:

{
  "merchant": "store or vendor name, or empty string if unclear",
  "amount": total amount paid as a plain number (no currency symbol, no commas),
  "date": "YYYY-MM-DD, use your best reading of the receipt date; if no date is visible, use null",
  "category": "one of: Food, Transport, Shopping, Bills, Health, Entertainment, Rent, Other — pick the closest fit",
  "note": "a short 3-6 word summary, e.g. 'Groceries at DMart' or 'Amazon order - electronics'"
}

Use the TOTAL / grand total amount, not a subtotal. If the image is not a receipt or the amount cannot be determined, set "amount" to null.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(raw || "{}");
    const { image, mediaType } = body;

    if (!image || !mediaType) {
      res.status(400).json({ error: "Missing image data" });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res
        .status(500)
        .json({ error: "Server is not configured with an API key" });
      return;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(anthropicRes.status).json({ error: errText.slice(0, 300) });
      return;
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No response text from Claude" });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: "Could not parse receipt data" });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown server error" });
  }
}
