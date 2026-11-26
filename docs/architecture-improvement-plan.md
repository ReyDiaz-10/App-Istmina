# IstmiYa architecture improvement plan

This plan improves reliability in small, reviewable steps. It does not replace the current architecture, change public routes or schema names, or apply unreviewed changes to production data.

## 1. CI quality gates, independent from EAS (in progress)

- Run app lint, TypeScript checking, unit tests, and web export on pushes and pull requests.
- Keep the EAS cloud APK workflow available by manual dispatch only, so routine pushes do not spend cloud build quota.
- Build Android APK locally in a Linux Docker container using the existing Expo preview profile and signing credentials.
- Next: add Supabase Edge Function type checks, SQL lint, migration order checks, and a CI database migration smoke test using an isolated disposable database.
- Acceptance: CI is green on a clean pull request; the Docker APK installs over the existing app without signature errors.

## 2. Bound external work and retry safely

- Add explicit request deadlines and bounded retries to notification dispatch and Gemini summarization.
- Process notifications in small bounded batches; retain the existing claim/acknowledge flow and idempotency.
- For Wompi payments and payouts, never blindly retry a POST that may have reached Wompi. On timeout or ambiguous response, keep the current reconciliation/manual-review path and look up the transaction before retrying.
- Keep PostgreSQL-calculated report totals authoritative; Gemini can only summarize aggregates.
- Add structured timings, attempt counts, and sanitized failure categories; do not log credentials, tokens, full recipient data, or payment secrets.
- Acceptance: tests cover timeout, 429/5xx, malformed response, duplicate delivery, ambiguous payment result, and retry exhaustion.

## 3. Compare migrations and permissions with a safe database

- Run Supabase migration status against a staging/project database and compare it with the repository migration history.
- Create a fresh disposable database from all migrations and run Supabase DB lint, function checks, and targeted RLS/role tests.
- Review Supabase Advisors for RLS, indexes, auth, and performance. Record findings and classify each as fix-now, accepted, or needs production evidence.
- Do not repair production drift automatically. Prepare a forward-only migration and backup/rollback plan, then review it before applying.
- Acceptance: migration history is explained, fresh DB builds successfully, and critical user/admin access tests pass.

## 4. Secrets, documentation, privacy, and credential history

- Reconcile the documented secret names with deployed code for Supabase, Render, Expo, Gmail relay, Gemini, and Wompi.
- Keep local environment examples value-free; confirm .env*, private keys, keystores, and APK outputs are ignored.
- Run a history-aware secret scanner on the Git repository. If a live credential is found, rotate/revoke it first; removing it from Git history alone does not make it safe.
- Complete privacy policy and data-retention documentation from actual data flows, then review with the product owner before publishing.
- Acceptance: a clean secret scan, a verified deployment matrix with owners, and privacy documentation that matches implemented behavior.

## 5. Consolidate data access gradually

- Map repeated Supabase queries by domain (profiles, businesses, orders, notifications, reports).
- Move one domain at a time into existing service modules, preserving query shape, permissions, and callers.
- Add service-level tests/fixtures and compare before/after behavior before migrating the next domain.
- Avoid broad screen rewrites and remove no routes, stores, RPCs, triggers, or business flows.
- Acceptance: a domain's callers use the service, query behavior is covered, and screen behavior remains unchanged.

## Execution order and release gate

Work in order 1 through 5. Phase 2 and later should land as small pull requests with tests. Production SQL, secret rotation, and publishing privacy/legal text require project-owner review and production evidence; they are not part of the local APK builder change.
