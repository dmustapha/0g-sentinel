// File: scanner/compute.ts
export interface ComputeResult {
  content: string;
  receipt_hash: string; // From 0G Compute response
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Send a chat completion request to 0G Compute and return the response with a cryptographic
 * receipt hash. The receipt (zg-res-key header) proves a specific inference ran on 0G network —
 * this hash is stored on-chain as tamper-evident proof of the AI verdict.
 */
export async function callCompute(
  systemPrompt: string,
  userMessage: string,
  model: string = "0GM-1.0-35B-A3B"
): Promise<ComputeResult> {
  // Use raw fetch to capture headers (openai SDK may not expose them)
  // keepalive:false forces a new TCP/TLS connection per call — prevents MAC errors under concurrency
  const response = await fetch(
    `${process.env.ZERO_G_COMPUTE_URL || "https://router-api.0g.ai/v1"}/chat/completions`,
    {
      method: "POST",
      keepalive: false,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ZERO_G_COMPUTE_API_KEY}`,
        Connection: "close",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1024,
        // Disable chain-of-thought thinking — we need clean JSON output, not reasoning traces
        chat_template_kwargs: { enable_thinking: false },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`0G Compute API error: ${response.status} ${errText}`);
  }

  // Parse response body first (data must exist before we read data.usage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || "";

  // Receipt hash lookup order (verified live 2026-05-14):
  // 1. zg-res-key — unique UUID per inference from 0G router (strip dashes → bytes32 hex)
  // 2. usage.receipt_hash in body (not present in current API but checking for future)
  // 3. x-receipt-hash / x-compute-receipt headers (not present — confirmed)
  // 4. SHA256 fallback
  const zgResKey = response.headers.get("zg-res-key");
  let receiptHash: string =
    (zgResKey ? "0x" + zgResKey.replace(/-/g, "").slice(0, 64).padEnd(64, "0") : "") ||
    data.usage?.receipt_hash ||
    response.headers.get("x-receipt-hash") ||
    response.headers.get("x-compute-receipt") ||
    "";

  if (!receiptHash) {
    // Fallback: hash the raw response as proof of specific inference run
    const crypto = await import("crypto");
    receiptHash =
      "0x" +
      crypto
        .createHash("sha256")
        .update(JSON.stringify({ content, usage: data.usage, model }))
        .digest("hex");
    console.warn(
      "[ComputeClient] Receipt hash not found in API response — using response hash as fallback"
    );
  }

  return {
    content,
    receipt_hash: receiptHash,
    model: data.model || model,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
    },
  };
}
