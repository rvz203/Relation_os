# Operations

## Runtime

Use separate development, test and production databases and keys. Run the migration service before the web app and worker. Keep one scheduled worker service; locking and unique keys also protect against overlapping workers. Mount the private upload directory outside public assets. Sessions and private API responses must never enter a public cache.

`GET /api/health` verifies the database connection. `worker_health.last_seen_at` records the scheduler heartbeat. Monitor messages in `unknown`, `failed`, and overdue `queued`/`retry_wait` states. Alert when the scheduler heartbeat or oldest ready message is more than ten minutes old. Settings displays outbound message state and allows provider reconciliation.

`npm run maintenance` applies the implemented retention cleanup: expired imports (seven days), sessions, throttling windows, idempotency responses (seven days), completed message bodies (ninety days) and audit records (one year). Outbound intent keys and completed-action dedupe keys remain durable to prevent replays. Schedule maintenance with the hosting platform. Review policy and encryption-key rotation before production; automatic key rotation and external operational alerts are not configured.

## SMS adapter

Default `SMS_MODE=sandbox` returns a synthetic **accepted** result with a `sandbox:` identifier. It never claims handset delivery. The HTTP adapter is available when `SMS_MODE=http`, `SMS_API_URL` and `SMS_API_TOKEN` are configured.

The adapter sends an HTTPS `POST` with bearer authentication and an `Idempotency-Key` equal to the immutable outbound message UUID:

```json
{"to":"+989...","text":"...","client_reference":"outbox UUID"}
```

The provider gateway must return `{ "status": "accepted", "id": "provider identifier" }` or `{ "status": "rejected" }`. HTTP 429 means definitely unaccepted and may be retried. Other 4xx responses are rejected. Timeouts, server errors and malformed success responses become **unknown**, because the provider may have accepted the message. Unknown messages are never automatically resent.

For reconciliation, the gateway must support authenticated `GET SMS_API_URL/{provider_message_id_or_client_reference}` returning `accepted`, `delivered`, `failed` or `unknown`. Adapt this contract to the selected Iranian SMS provider and test its idempotency/status behavior in its sandbox before enabling real sends. No provider-specific integration has been selected or verified.

Optional receipts go to `POST /api/v1/sms/webhooks/http`. Configure `SMS_WEBHOOK_SECRET`. Headers:

- `X-SMS-Timestamp`: Unix seconds, within five minutes.
- `X-SMS-Signature`: hex HMAC-SHA256 of `timestamp + "." + raw_body` using the webhook secret.

Body: `{ "client_reference": "outbox UUID", "provider_message_id": "...", "status": "accepted|delivered|failed" }`. Receipts are repeatable and cannot downgrade a delivered message. Never log full phone numbers, addresses, SMS text, provider credentials or raw provider responses.

Before enabling real SMS, replace synthetic florist phone numbers, confirm delivery addresses, choose currency and leap policies, verify provider balance, and review a full preview. An accepted florist SMS leaves the flower action pending. Only the owner's completion confirms the action and creates a direct flower interaction.

## Flower timing and recovery

A flower intent sends at the configured local time on the day before delivery. A late registration on that same previous day can still run before its end. A registration on delivery day or later requires explicit manual preview and send. Completing, cancelling or archiving prevents future queued work. Messages already processing or accepted cannot be recalled; the UI warns about manual coordination.

A lease that expires after a sender crash becomes `unknown`. Reconcile with the provider before any resend. Do not reset `unknown` or `accepted` to `queued` in SQL. Keep the original intent UUID and its provider reference.

## Backups and restore

Use encrypted daily database backups and encrypted storage with at least thirty days of rotation. Back up private photo storage and `DATA_ENCRYPTION_KEY` separately. Use a PostgreSQL client compatible with the database server version.

With `DATABASE_URL` and `BACKUP_PASSWORD` in the process environment:

```bash
scripts/ops/backup.sh /secure/backup/directory
```

To restore into a dedicated recovery database, first stop the worker and point `DATABASE_URL` at the recovery target. The restore replaces that target's objects. Set `RESTORE_ACK=I_HAVE_STOPPED_SMS`, then:

```bash
scripts/ops/restore.sh /secure/backup/file.dump.enc
```

The restore script disables SMS and marks in-progress messages unknown. Reconcile all provider activity since the backup timestamp before re-enabling sends. Do not start the worker on the recovered database until this review is complete. Validate login, decryption, graph counts, upcoming dates and message state, then restore uploads and perform an application smoke test.

The specification's 24-hour RPO and four-hour RTO are operational targets. They require production backup scheduling, storage and a measured recovery exercise; they are not guaranteed by these scripts.

## Hosting

Run `npm run build`, apply reviewed migrations and start Next.js with `npm start`. Runtime settings are injected by the hosting platform. Docker Compose supplies an isolated PostgreSQL 17 service and waits for migrations before starting the app and worker. The Docker image also retains the administrative TypeScript commands.

The original Sites manifest is retained only as source provenance. Standard Next.js and the `pg` TCP driver need Node-compatible hosting. Do not publish this repository using the original Vinext/Cloudflare Worker workflow without a separate adaptation and a supported external database connection.
