# Codex handoff: scalp prediction retry

Updated: 2026-09-10. Start here when continuing on another PC.

## Checkout and scope

Clone `https://github.com/ippeitanaka/ai-trader-supabase.git`, fetch origin, and use the latest `main`. Do not depend on another PC's Codex task history or local paths. Read this file, README.md, and docs/ea-runtime-controls.md before changing execution behavior.

The user requested fixing skips containing `no-trade / scalp outcomes unavailable` and authorized committing, pushing, merging, and deploying this fix. This authorization does not extend to unrelated future changes.

## Problem and change

The provider loop accepted nonempty completed responses before validating JSON, probability fields, or scalp outcome estimates. Invalid predictions therefore bypassed the backup model and entered a rule-based fallback that cannot estimate timed-exit payouts and blocks scalp entries.

- `supabase/functions/ai-trader/prediction-request.ts`: provider request loop; invalid JSON or rejected predictions try the next configured model within the existing two-model sequence.
- `prediction-validation.ts`: validates numeric probabilities and scalp expected-value inputs, including consistency between aggregate win probability and outcome probabilities.
- `index.ts`: connects validation to provider selection. Each model timeout is capped at 12 seconds (two models at most 24 seconds of provider waiting; database and other processing add overhead). MT5's HTTP timeout is 30 seconds, so total response time is not guaranteed.
- `prediction-request_test.ts`: mocked-provider regression tests for missing/inconsistent outcomes, broken JSON, invalid direction probability, all-provider failure, standard mode compatibility, and timeout recovery.

A valid backup response proceeds through existing execution guards. Both models failing still blocks scalp entries. No synthetic payout estimates or weakened execution thresholds were introduced. No migration or EA recompilation is needed for this change.

## Validation

Run from the repository root with Deno installed, or use `npx -y deno`:

```sh
deno test --allow-env supabase/functions/ai-trader/*_test.ts
deno check supabase/functions/ai-trader/index.ts
git diff --check
```

Before commit: 30 tests passed and Edge type checking passed. Tests mock OpenAI; no live orders or production writes were used for validation.

## Release and operations

A merge to main triggers `.github/workflows/deploy.yml` (Deploy to Supabase), which pushes DB migrations and deploys all seven Edge Functions. Even though this change has no migration, the workflow still performs its normal DB step. Confirm the workflow for the exact merge SHA is successful; do not equate a successful push with deployment completion. Use the PR and GitHub Actions history for final release status.

After deployment, inspect naturally occurring ai-trader requests. Look for `invalid prediction; trying next model` followed by `Prediction model:` showing backup success. Do not send a live trading request just to test deployment. The original production incident's precise API failure has not been established from logs; key misconfiguration, simultaneous provider outage, or slow DB calls remain possible causes of skips. Do not promise elimination of all skips.

For further diagnosis, read provider failures and request timing without printing credentials. Existing logs can label an internally recovered fallback as OpenAI success, so inspect detailed provider messages rather than only the outer prediction-method label.

Rollback through a reviewed revert of the fix and a successful main deploy. Keep API keys and service-role credentials out of this file, git, and chat.
