# Transaction integration onto main — 2026-10-23

- Base: remote main verified through GitHub connector at 388319c87176fe13a93569d32c9e4bc069865ab7.
- Applied 947dd7779785ca48648cf488fc314a9de14b811e with cherry-pick --no-commit in an isolated managed worktree.
- Branch: codex/transaction-main-integration. No commit, push, production deployment, or live DB writes performed.
- No textual conflicts. Reviewed automatic merges in students, class students, week grade, and week questions routes.
- Preserved main's collectPages student/roster pagination, grade display_order ordering, and sortQuestionsByPdf question ordering.
- PDF import, OCR photo storage, question presentation helpers, and other worktree changes remain untouched.
- Both migration files match 947dd77 exactly; no additional migration or RLS/trigger modification introduced.

## Regression verification

- Added question GET regression for PDF order, source numbering and choice payload preservation, plus PATCH regression for a single authenticated transaction containing the full edit batch.
- Added PGlite PostgreSQL regression proving PDF source mapping survives an answer-key change while student correctness and aggregate scores are updated.
- Adapted existing GET-only pagination tests to mock POST-only server persistence modules after the integration added server imports.
- npm run check: PASS; TypeScript success; ESLint 0 errors and existing 21 warnings; 133 test files and 1279 tests passed.
- Existing transaction suite exercises rollback, cross-teacher access restrictions, production policy expressions, and stale grading input rejection. No paid LLM or production DB test performed.
- Full verification log: tmp/transaction-integration-check.log (local only).
