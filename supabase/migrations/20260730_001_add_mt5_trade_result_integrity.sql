alter table public.ai_signals
  add column if not exists mt5_position_id bigint,
  add column if not exists mt5_position_ticket bigint,
  add column if not exists entry_deal_ticket bigint,
  add column if not exists exit_deal_ticket bigint,
  add column if not exists realized_commission numeric,
  add column if not exists realized_swap numeric,
  add column if not exists realized_fee numeric,
  add column if not exists result_consistent boolean,
  add column if not exists result_quality_reason text,
  add column if not exists tracking_version text;

create index if not exists idx_ai_signals_mt5_position_id
  on public.ai_signals (mt5_position_id)
  where mt5_position_id is not null;

create index if not exists idx_ai_signals_inconsistent_results
  on public.ai_signals (closed_at desc)
  where result_consistent = false;

comment on column public.ai_signals.mt5_position_id is
  'Stable MT5 POSITION_IDENTIFIER / DEAL_POSITION_ID used across terminal restarts';
comment on column public.ai_signals.mt5_position_ticket is
  'Current MT5 POSITION_TICKET used by PositionSelectByTicket';
comment on column public.ai_signals.result_consistent is
  'Whether trade direction, entry/exit prices and realized result are internally consistent';
comment on column public.ai_signals.result_quality_reason is
  'Machine-readable reason when a trade result should be excluded from learning';
comment on column public.ai_signals.tracking_version is
  'EA trade tracking implementation that produced the result';

-- Flag legacy real trades whose recorded direction and price move contradict P/L.
-- Rows without enough information remain NULL and can still be inspected manually.
update public.ai_signals
set
  result_consistent = case
    when abs(coalesce(profit_loss, 0)) <= 0.01 then true
    when ((exit_price - entry_price) * dir) = 0 then true
    when profit_loss > 0 and ((exit_price - entry_price) * dir) < 0 then false
    else true
  end,
  result_quality_reason = case
    when abs(coalesce(profit_loss, 0)) <= 0.01 then null
    when ((exit_price - entry_price) * dir) = 0 then null
    when profit_loss > 0 and ((exit_price - entry_price) * dir) < 0
      then 'positive_pnl_against_recorded_direction'
    else null
  end,
  tracking_version = coalesce(tracking_version, 'legacy_backfill')
where coalesce(is_virtual, false) = false
  and coalesce(is_manual_trade, false) = false
  and closed_at is not null
  and actual_result in ('WIN', 'LOSS', 'BREAK_EVEN')
  and dir in (-1, 1)
  and entry_price is not null
  and exit_price is not null
  and profit_loss is not null
  and result_consistent is null;
