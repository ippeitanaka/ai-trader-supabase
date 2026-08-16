alter table public.ai_signals
  add column if not exists strategy_mode text not null default 'standard',
  add column if not exists exit_reason text,
  add column if not exists max_hold_minutes integer;

alter table public."ea-log"
  add column if not exists strategy_mode text not null default 'standard',
  add column if not exists max_hold_minutes integer;

alter table public.ai_config
  add column if not exists max_cost_r double precision,
  add column if not exists direction_horizon_minutes integer,
  add column if not exists max_hold_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_signals_strategy_mode_check'
  ) then
    alter table public.ai_signals
      add constraint ai_signals_strategy_mode_check
      check (strategy_mode in ('standard', 'scalp'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ea_log_strategy_mode_check'
  ) then
    alter table public."ea-log"
      add constraint ea_log_strategy_mode_check
      check (strategy_mode in ('standard', 'scalp'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_signals_max_hold_minutes_check'
  ) then
    alter table public.ai_signals
      add constraint ai_signals_max_hold_minutes_check
      check (max_hold_minutes is null or max_hold_minutes between 5 and 240);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ea_log_max_hold_minutes_check'
  ) then
    alter table public."ea-log"
      add constraint ea_log_max_hold_minutes_check
      check (max_hold_minutes is null or max_hold_minutes between 5 and 240);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_config_scalp_runtime_check'
  ) then
    alter table public.ai_config
      add constraint ai_config_scalp_runtime_check
      check (
        (max_cost_r is null or max_cost_r between 0 and 0.5)
        and (direction_horizon_minutes is null or direction_horizon_minutes between 5 and 240)
        and (max_hold_minutes is null or max_hold_minutes between 5 and 240)
      );
  end if;
end $$;

create index if not exists idx_ai_signals_strategy_mode_outcomes
  on public.ai_signals (strategy_mode, timeframe, closed_at desc)
  where actual_result in ('WIN', 'LOSS', 'BREAK_EVEN');

create index if not exists idx_ea_log_strategy_mode_created
  on public."ea-log" (strategy_mode, created_at desc);

insert into public.ai_config (
  instance,
  min_win_prob,
  tf_entry,
  tf_recheck,
  risk_atr_mult,
  reward_rr,
  pending_expiry_min,
  max_cost_r,
  direction_horizon_minutes,
  max_hold_minutes,
  updated_at
)
values (
  'scalp',
  0.62,
  'M5',
  'M15',
  1.4,
  1.1,
  30,
  0.12,
  20,
  30,
  now()
)
on conflict (instance) do nothing;

comment on column public.ai_signals.strategy_mode is
  'Execution strategy family. standard=M15 swing-like mode, scalp=M5 short-horizon mode.';
comment on column public.ai_signals.exit_reason is
  'Why the real position was closed, including TP, SL, or scalp_time_exit.';
comment on column public."ea-log".strategy_mode is
  'EA strategy mode that produced this decision.';
