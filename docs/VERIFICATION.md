# Verification

Updated on 5 November 2026. Executed against local PostgreSQL 14 with fictional records and sandbox SMS. See [the specification review](SPECIFICATION_REVIEW.md) for the full AC01–AC15 and T01–T09 matrix.

## Automated checks

- TypeScript checking and a Next.js production build.
- Seven domain tests (including DST gaps and ambiguous times): Jalali annual recurrence, both leap policies, Gregorian leap-day behavior, inclusive today, Tehran florist scheduling, Persian normalization, encryption integrity and password verification.
- Twenty-nine API/database integration checks: unauthenticated access, CSRF, idempotent creates, cross-owner people access, normalized search, introduction cycles, optimistic versions, symmetric edges, today's occasion, concurrent completion, flower validation/preview/sandbox acceptance, unknown-send blocking, duplicate reminder execution, two-pass CSV import, duplicate decisions, rollback, XLSX/formula validation, archive cancellation and session revocation. Additional scenarios cover complete profile fields, required edit versions, bounded graph flags, action reminders, owner-only in-app recipients, grace periods, attempt snapshots, signed receipts, expired leases, frozen asynchronous imports, existing-network cycles, future timezone changes, monitoring, initial passwords, late rollback, reservation/edit races, retry exhaustion and validated private photos. Some checks exercise several related assertions.

The integration runner creates temporary owners and removes their data after the run. SMS tests call only the sandbox adapter. Accepted and delivered remain distinct.

## Browser checks

Login with the local demo account; add a synthetic person; automatic profile opening; page reload with the saved person still present; dashboard and people navigation. Additional final browser review is recorded in the chat handoff.

The graph was expanded from the central person and a real graph node opened its PostgreSQL profile and introduction path. An encrypted backup was restored into an isolated temporary PostgreSQL database; owner counts were preserved and SMS was disabled by the restore procedure. The temporary database was removed after verification. This local exercise does not establish production RPO or RTO.

The optimized production server passed health, login, dashboard and logout smoke checks. Its browser console had no errors during final review. Persian month navigation and Settings were checked in the browser, and `outputs/relationship-os-dashboard.png` captures the resulting dashboard. Docker Compose configuration validated; container startup was not exercised.

## Production acceptance still required

- Owner UAT against the full Persian specification and real import samples.
- Selected provider sandbox tests for receipts, request timeouts, lost responses, status reconciliation and account balance.
- Repeat the locally passing 10,000-person / 50,000-edge, ten-session benchmark on production-equivalent infrastructure. Local list/search p95: 13–18 ms; graph: 65 ms. See `performance-local.json`.
- Production mobile devices, assistive technology, infrastructure encryption, monitoring destinations and backup rotation.
- Confirmation of currency, send time, leap-day and retention policies.
- Production deployment, provider credentials and geographic/network accessibility.

The implementation deliberately uses a PostgreSQL-backed worker rather than Django/Celery/Redis to fit the requested Next.js stack. Stored queue state remains in PostgreSQL. It includes a generic HTTP provider gateway contract rather than a provider-specific adapter.
