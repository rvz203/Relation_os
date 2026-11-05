# Specification review — 5 November 2026

Reviewed against `Relationship_OS_Technical_Specification_FA (1).docx`, version 1.0 dated 18 September 2026. This records implementation and local verification, not product-owner UAT or a production launch approval. The requested Next.js/PostgreSQL stack takes precedence over the document's proposed Django/Celery stack.

## Corrections made in this review

- Completed optional profile information, separate expertise and label tags, first meeting/acquaintance notes, duplicate-mobile warnings and next-action display. Added relationship provenance/start dates and occasion notes.
- Required the version supplied by the caller on record edits; merging current data can no longer bypass optimistic concurrency. Initial owner passwords now gate private features until changed, and password changes revoke sessions.
- Added a Jalali/Gregorian date picker alongside validated manual input, persisted display-calendar settings, action filters, timeline filters, action-linked reminders, concrete occasion selection and reminder editing. Settings can manage tags and relationship types and inspect message attempts.
- Bounded graph traversal to 200 nodes, retained the root, reported omitted neighbors and displayed importance/direction. Existing drag, zoom, shared-branch visibility and the keyboard-accessible relationship list remain available.
- Completed SMS attempt snapshots, lease recovery, signed receipt handling and shared reconciliation effects. Provider acceptance remains separate from handset delivery and owner-confirmed flower completion. A failed later delivery cannot allow an already accepted initial flower intent to be resent. Manual approval is checked again if the recipient/text changes before reservation. Retry limits, deadlines and missed-reminder warnings are enforced.
- Completed delivery time/timezone/notes, future unsent rescheduling and DST handling: nonexistent wall times advance to the first valid minute, ambiguous times choose the first instant.
- Added existing-network import references and legacy exact-name parents, cycle checks against the existing network, explicit reimport, distinct imported tags, asynchronous frozen commits and recovery leases. A late constraint failure rolls back the entire import. Expiring staging retains checksum metadata for duplicate detection.
- Added bounded request bodies, independent monitoring, incident deduplication, queue/heartbeat/API metrics, an optional balance gateway and optional HTTPS operations receiver. Added at least 30-day backup rotation, snapshot retention cleanup and a repeatable isolated recovery exercise.

Migrations `002`–`005` are additive and have been applied to the local database. New runtime commands are documented in `OPERATIONS.md` and `.env.example`. No real SMS was sent during verification.

## Acceptance matrix

| Criteria | Implementation and evidence                                                                                                                       | Remaining acceptance                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| AC01     | Quick person form; API creation, optional fields, automatic profile opening and persistence checked                                               | Owner timing/UAT for the under-one-minute usability target  |
| AC02     | Introducer/path, self-reference and cycle rejection; owner lock and composite FKs                                                                 | Owner review of real introduction paths                     |
| AC03     | Typed multiple edges, canonical symmetric edges and duplicate constraints; reversed duplicate API test                                            | None identified in implementation                           |
| AC04     | Bounded graph, root retention, incremental branches and cycle-safe traversal; API and browser checks                                              | Real-device touch/keyboard usability                        |
| AC05     | Separate expertise/labels, Persian/Arabic normalization, literal search and tag filtering tested                                                  | Real vocabulary samples                                     |
| AC06     | Jalali recurrence retains the original month/day across years; domain tests                                                                       | None identified in implementation                           |
| AC07     | Unknown year and both leap policies tested in Jalali and Gregorian calendars                                                                      | Owner confirms default leap policy                          |
| AC08     | Person/concrete-occasion actions and atomic flower details; concurrent completion produces one interaction                                        | Owner workflow review                                       |
| AC09     | Once/per-occurrence reminders, owner-only in-app recipient, timezone/DST, 24-hour grace and intent dedupe tested                                  | Host scheduler/worker must run continuously                 |
| AC10     | Accepted/delivered split, unknown/lost response, expired lease, attempt snapshots, signed receipts and retry exhaustion tested                    | Selected provider's real sandbox contract and balance check |
| AC11     | Previous-local-day 09:00 scheduling and delivery-day manual approval tested                                                                       | Owner confirms default send hour                            |
| AC12     | Positive integer budget, explicit IRT/IRR and preview checked                                                                                     | Owner confirms currency and order text                      |
| AC13     | Dated manual interactions, stable ordered timeline and type filtering implemented                                                                 | Owner reviews real historical data                          |
| AC14     | Florist coordination does not change direct-contact time; direct SMS receipts deduplicate and count only when delivered                           | None identified in implementation                           |
| AC15     | CSV/XLSX, parent-after-child, explicit duplicate decisions, formulas, external references, existing-network cycles and late-error rollback tested | Real import samples and owner UAT                           |

## Risk matrix

| Risk | Local evidence                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01  | Concurrent schedulers create one intent; overlapping reminder processing produces one notification                                                                                   |
| T02  | Simulated lost provider response becomes unknown; automatic resend stops                                                                                                             |
| T03  | Edit after reservation returns SEND_STARTED; unsent version checks and changed-preview cancellation tested                                                                           |
| T04  | Cross-owner people, import jobs, messages and private photo requests rejected; composite network FKs remain enforced                                                                 |
| T05  | Same request key/body replays, changed body conflicts, same import checksum/job does not repeat                                                                                      |
| T06  | Person archive cancels dependent work; florist deactivation cancels future intents and alerts; reservation rechecks active state                                                     |
| T07  | Inclusive today, Jalali/Gregorian leap rules, future timezone rescheduling, DST gaps/repeated hours and delivery-day orders tested                                                   |
| T08  | No Redis dependency; durable PostgreSQL intent/lease state used by web and worker                                                                                                    |
| T09  | Encrypted backup restored to a disposable database; counts and decryption preserved, SMS disabled and processing cleared; live-provider reconciliation remains a production exercise |

## Verification and performance

Seven domain tests and 29 API/database integration scenarios pass, with synthetic disposable owners and sandbox SMS. TypeScript and production build checks pass. The browser review covered the action filters, settings/monitoring controls, reminder targets and Jalali day selection. No unsaved browser drafts were submitted during this review. A separate recovery test verifies encrypted backup and restore without replacing the working database.

The production-server local benchmark used 10,000 people, 50,000 relationships, 10 authenticated concurrent sessions and 150 requests per endpoint. List/search p95 was 13–18 ms and bounded graph p95 was 65 ms. See `performance-local.json` for the exact routes and measurements. This passes the local 800 ms target; repeat it on production-equivalent infrastructure. Benchmark data and recovery databases are removed after the run.

## External setup still required

- Node-compatible hosting, production PostgreSQL, private photo storage, HTTPS and secure environment variables.
- A selected SMS gateway with confirmed idempotency, receipts, status lookup, text limits and balance semantics; production numbers/addresses and approved order text.
- A running worker and monitor, configured operations receiver, daily backup/maintenance schedules, encrypted infrastructure/storage and an independently retained encryption key.
- Measured production RPO ≤24 hours/RTO ≤4 hours, provider reconciliation after restore, production performance and 360px/assistive-technology/device testing.
- Product-owner UAT and confirmation of send hour, leap policy, currency and retention policy.

These are deployment and acceptance dependencies. The app does not claim that a public production service, real SMS integration or production disaster-recovery guarantees have been provisioned.
