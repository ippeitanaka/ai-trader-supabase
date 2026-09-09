# Installed EA Controls (v2.2.0)

## Behavior

- The dashboard lists EA instances registered through authenticated heartbeats, not inferred from old trade logs.
- Heartbeats are sent every 120 seconds. More than six minutes without reception is shown as stale, not proof that the EA is removed.
- Settings are shared by symbol and strategy mode. M5 scalp and M15 standard have independent settings; multiple instances of the same symbol/mode share them.
- Manual probability thresholds accept 50 through 90 percent in one-point increments. These are execution thresholds, not guarantees of realized win rate.
- Trading windows use Asia/Tokyo, support overnight windows, and allow up to three windows or an explicit all-day setting.
- Individual settings override the daily plan's threshold and hours and persist across daily plan regeneration. Inherit returns control to the daily plan/defaults.
- Other execution guards, plan pause, emergency stop, cost and chart checks remain active. Nonrecommended membership alone is not a blocker.
- Settings apply to subsequent entry decisions, not forced closure of existing positions.

## Deployment Order

1. Apply `supabase/migrations/20260909_001_add_ea_runtime_controls.sql` to the intended database. Confirm both `ea_instances` and `ea_runtime_settings` exist with RLS enabled.
2. Deploy `ea-log` and `ai-trader`, including the shared module. The new trader fails closed if it cannot read the settings table, so do not deploy it before the migration.
3. Deploy the Web application. Its build must include the repository-level `supabase/functions/_shared` source, not only the `web` directory.
4. Compile `mt5/AwajiSamurai_AI_2.0.mq5` (AI_EA_Version 2.2.0) with MetaEditor and replace the installed EA. Preserve the existing EA log bearer token.
5. Verify heartbeats appear, then verify a setting is saved and reflected in the next decision without placing a test live order.

The EA also corrects the iBands parameter order and buffer mapping: shift 0, deviation 2.0; buffer 0 middle, 1 upper, 2 lower.

## Verification And Release Limits

## Probability And Daily Selection Changes

- Daily selection retries incomplete/invalid JSON responses, bounds each provider attempt to 45 seconds and records HTTP/timeout/output failures in the fallback plan summary. Actual provider model names are retained. This improves diagnosis; it does not establish the historical cause of the September 8 fallback without its execution logs.
- Scalp EV uses separate TP, SL, profitable timeout and nonprofitable timeout probabilities and conditional net timeout payouts. Calibration reweights winning/losing mass, not payout magnitude. Invalid or unavailable scalp outcomes prevent entry rather than treating every profitable timeout as a full TP win.
- Model raw probability is captured before optional ML adjustments. Opposite-direction final-score snapshots cannot supply raw calibration inputs; their final scores and outcomes remain available.
- Apply `20260909000200_quarantine_snapshot_probabilities.sql` as well. It nulls falsely labeled raw/intermediate fields only for `final_probability_snapshot` rows, preserving final probabilities and results.
- Scalp evidence receives current-target weighting and 30-minute episode grouping. This does not prove calibrated probabilities or future profitability; forward outcome monitoring remains necessary.

## Verification And Release Limits

Shared validation/guard tests, Edge type checks, Web lint and production build passed during development. Browser validation uses a local mock Supabase, never production writes. Real Supabase migration execution and MetaEditor compilation are separate release checks.

Existing dashboard POST routes have no application-level authentication. Protect the dashboard and mutation endpoints with authenticated access before production exposure; database RLS alone does not protect a server route using the service-role credential.
