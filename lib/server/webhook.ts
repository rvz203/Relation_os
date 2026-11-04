import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "@/db";
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
  return transaction(async (db) => {
    const [m] = await query(
      "SELECT * FROM outbox_messages WHERE id=$1 FOR UPDATE",
      [d.client_reference],
      db,
    );
    if (!m || !["processing", "unknown", "accepted"].includes(m.state))
      return { ok: true };
    if (
      m.provider_message_id &&
      d.provider_message_id &&
      m.provider_message_id !== d.provider_message_id
    )
      fail("Provider message mismatch.", 409);
    await db.query(
      "UPDATE outbox_messages SET state=$2,provider_message_id=coalesce(provider_message_id,$3),locked_until=NULL,updated_at=now() WHERE id=$1",
      [m.id, d.status, d.provider_message_id ?? null],
    );
    if (m.action_id && ["accepted", "delivered"].includes(d.status))
      await db.query(
        "UPDATE flower_details SET sms_accepted_at=coalesce(sms_accepted_at,now()) WHERE user_id=$1 AND action_id=$2",
        [m.user_id, m.action_id],
      );
    await audit(db, m.user_id, "provider_" + d.status, "message", m.id);
    return { ok: true };
  });
}
