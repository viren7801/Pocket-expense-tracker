// Calls your own serverless function at /api/scan-receipt, which holds the
// Claude API key server-side. The browser never sees the key.

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export async function scanReceipt(file) {
  const base64 = await fileToBase64(file);
  const mediaType = file.type || "image/jpeg";

  const response = await fetch("/api/scan-receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, mediaType }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 500 && /API key/i.test(body.error || "")) {
      throw new Error("SERVER_NOT_CONFIGURED");
    }
    throw new Error(body.error || "REQUEST_FAILED");
  }

  if (
    body.amount === null ||
    body.amount === undefined ||
    isNaN(Number(body.amount))
  ) {
    throw new Error("NO_AMOUNT_FOUND");
  }

  return {
    merchant: body.merchant || "",
    amount: Number(body.amount),
    date:
      body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : new Date().toISOString().slice(0, 10),
    category: body.category || "Other",
    note: body.note || body.merchant || "",
  };
}
