import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applyDeliveryResult } from "./delivery";
import { query, transaction, lockOwner } from "@/db";
import { fail, audit } from "./core";
export async function receiveSMSWebhook(
  raw: string,
  timestamp: string | null,
  signature: string | null,
) {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (!secret)
    fail("Webhook is not configured.", 503, "PROVIDER_NOT_CONFIGURED");
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300)
    fail("Invalid webhook timestamp.", 403, "INVALID_SIGNATURE");
  const expected = createHmac("sha256", secret)
    .update(timestamp + "." + raw)
    .digest("hex");
  if (
    !signature ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    fail("Invalid webhook signature.", 403, "INVALID_SIGNATURE");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Invalid JSON.", 400, "INVALID_JSON");
  }
  const d = z
    .object({
      client_reference: z.string().uuid(),
      provider_message_id: z.string().max(200).optional(),
      status: z.enum(["accepted", "delivered", "failed"]),
    })
    .parse(parsed);
  const [m] = await query(
    "SELECT user_id,provider_message_id FROM outbox_messages WHERE id=$1",
    [d.client_reference],
  );
  if (!m) return { ok: true };
  return transaction(async (db) => {
    await lockOwner(db, m.user_id);
    if (
      m.provider_message_id &&
      d.provider_message_id &&
      m.provider_message_id !== d.provider_message_id
    )
      fail("Provider message mismatch.", 409);
    await applyDeliveryResult(db, m.user_id, d.client_reference, {
      state: d.status,
      provider_id: d.provider_message_id,
    });
    return { ok: true };
  });
}
