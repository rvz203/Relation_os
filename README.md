# Relationship OS

A Persian, right-to-left relationship manager built with **Next.js 16, React 19, TypeScript and PostgreSQL**. This implementation uses the supplied Persian technical specification and preserves the original site's interface, visual language and bundled Vazirmatn font.

The original browser-memory prototype has been replaced with authenticated APIs and durable database records. The PostgreSQL app runs on a Node.js host. The existing ChatGPT Sites publication has not been redeployed: its Worker runtime does not support this application's standard PostgreSQL TCP connection.

## Run locally

Requirements: Node.js 22.13+ and PostgreSQL 14+. The current workspace already has dependencies, an ignored `.env`, a migrated local `relationship_os` database and synthetic demo data.

```bash
npm run dev -- --port 3001
```

Open **http://localhost:3001**. Port 3000 was already occupied by another application on this computer.

Local demonstration account:

- Email: `demo@relationship.local`
- Password: `Relationship-Demo-2026!`

This account contains fictional records. SMS uses **sandbox** mode and never contacts a real recipient. Change the demo password or create a separate owner before using real data.

Run the durable scheduler and sender in a second terminal:

```bash
npm run worker
# A single scheduler/sender pass:
npm run worker -- --once
```

Both API and worker read PostgreSQL directly. Queue state survives process restarts; Redis is not required. The worker wakes every 30 seconds and uses owner locks, row locks, unique intent keys and leases to prevent duplicate work.

## Fresh installation

```bash
npm ci
cp .env.example .env
createdb relationship_os
```

Edit `.env` with your PostgreSQL connection string and an encryption key generated using `openssl rand -hex 32`. Keep `APP_ORIGIN` equal to the exact URL used in the browser; the default here is `http://localhost:3001`.

```bash
npm run db:migrate
npm run db:seed
npm run dev -- --port 3001
```

For an empty workspace with your own account, skip the demo seed. Set `OWNER_EMAIL`, `OWNER_PASSWORD` (at least 12 characters) and optionally `OWNER_NAME` in the process environment, then run `npm run owner:create`. Passwords are salted with scrypt. Public registration is disabled. Change a password from Settings; this revokes every session for that owner.

## Included workflows

- Dashboard for today, the next seven days and the next thirty days, with overdue actions and people to reconnect with.
- People: fast entry, editing, expertise/tags, A/B/C importance, normalized Persian search, private notes, photos and archival.
- Relationships: multiple typed edges, directed and symmetric relationships, introduction paths and a graph with branch expansion, drag, zoom and centering.
- Dates: Jalali and Gregorian source dates, unknown birth years, once/yearly recurrence and explicit leap-day policies. Mobile calendar uses a monthly list.
- Actions: calls, messages, meetings, gifts, flowers and custom work. Completion creates one timeline interaction even if the request repeats.
- Flowers: explicit budget/currency, independent address snapshot, florist, card text, previous-day local scheduling and a signed, expiring manual-send preview.
- Reminders: inside the app or SMS, one-time or attached to every occurrence of an occasion. A recurring birthday never creates a new financial flower order automatically.
- Timeline: actual interaction time, with notes and florist coordination excluded from the last direct-contact calculation.
- CSV and XLSX import: upload, column mapping, errors, explicit duplicate decisions, two-pass parent resolution and an atomic, repeatable commit.
- Owner-scoped API access, HttpOnly sessions, origin/CSRF checks, login throttling, optimistic versions, database integrity constraints and audit events.

Private notes, stored addresses, reminder text, interaction notes, staged imports and complete SMS snapshots use versioned AES-256-GCM encryption. Keep `DATA_ENCRYPTION_KEY` safely backed up separately from the database; losing it makes those records unreadable.

## API and project layout

- `app/api/v1/[...path]/route.ts`: same-origin API entry point.
- `lib/server/`: domain services, authentication, imports, messaging and provider receipts.
- `db/migrations/`: transactional, versioned PostgreSQL migrations with composite owner foreign keys.
- `components/workspace/`: interactive views and forms.
- `scripts/worker.ts`: persistent scheduler and sender.
- `docs/openapi.json`: generated API schemas and route catalog. Regenerate with `npm run api:generate`.
- `docs/OPERATIONS.md`: deployment, SMS contract, backups and recovery.
- `docs/VERIFICATION.md`: executed checks and remaining acceptance work.

API base: `/api/v1`. Mutations require the session's `X-CSRF-Token` and matching `Origin`. Creating people/actions and sending a flower SMS require an `Idempotency-Key`. The client retains each form's key through a retry. Errors use `{error:{code,message,fields,request_id}}`. Health endpoint: `/api/health`.

## Checks

```bash
npm run typecheck
npm test
# Start this app on APP_ORIGIN first; SMS_MODE must be sandbox.
npm run test:integration
npm run build
```

Integration checks create two temporary synthetic owners and clean up only their data. Do not point the integration runner at a live deployment.

## Deploy

The repository includes a Dockerfile and Compose services for PostgreSQL, migrations, Next.js and the worker. Supply `POSTGRES_PASSWORD`, `DATA_ENCRYPTION_KEY`, `APP_ORIGIN` and the remaining runtime environment values in `.env`, then run:

```bash
docker compose up --build -d
```

Create the production owner inside the app container using `npm run owner:create` and environment variables. Put HTTPS in front of the app and set `APP_ORIGIN` to that HTTPS origin. A Node-compatible host with a PostgreSQL database and a persistent worker is required. Deployment credentials and a real SMS provider have not been supplied, so public hosting and live SMS are pending configuration.

## Specification review

The 5 November review and AC01–AC15/T01–T09 matrix are in [docs/SPECIFICATION_REVIEW.md](docs/SPECIFICATION_REVIEW.md). Run `npm test`, `npm run test:integration`, `npm run test:performance` and `npm run test:recovery` against local synthetic/sandbox environments; performance expects a running production server and uses `APP_ORIGIN`. Integration tests require a running app with the same origin. `npm run monitor` runs the independent incident monitor. Production provider, hosting, operations destinations and owner UAT remain deployment dependencies.
