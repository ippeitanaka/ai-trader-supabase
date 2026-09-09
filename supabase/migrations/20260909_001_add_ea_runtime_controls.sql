create table if not exists public.ea_instances (
  id text primary key,
  symbol text not null,
  strategy_mode text not null check (strategy_mode in ('standard', 'scalp')),
  timeframe text not null,
  ea_version text not null,
  last_seen_at timestamptz not null default now(),
  attached boolean not null default true,
  broker_connected boolean not null default false,
  auto_trading_enabled boolean not null default false,
  current_positions integer not null default 0 check (current_positions >= 0),
  base_lot_size numeric not null check (base_lot_size > 0),
  max_open_trades integer not null check (max_open_trades >= 1)
);

create index if not exists ea_instances_last_seen_idx on public.ea_instances (last_seen_at desc);
create index if not exists ea_instances_symbol_mode_idx on public.ea_instances (symbol, strategy_mode);

create table if not exists public.ea_runtime_settings (
  symbol text not null,
  strategy_mode text not null check (strategy_mode in ('standard', 'scalp')),
  min_win_prob numeric check (
    min_win_prob between 0.50 and 0.90 and min_win_prob * 100 = trunc(min_win_prob * 100)
  ),
  session_override jsonb check (
    session_override is null or (
      jsonb_typeof(session_override) = 'object' and
      session_override ->> 'timezone' = 'Asia/Tokyo' and
      session_override ->> 'mode' in ('all_day', 'custom')
    )
  ),
  updated_at timestamptz not null default now(),
  primary key (symbol, strategy_mode)
);

alter table public.ea_instances enable row level security;
alter table public.ea_runtime_settings enable row level security;
revoke all on public.ea_instances, public.ea_runtime_settings from anon, authenticated;
grant select, insert, update on public.ea_instances, public.ea_runtime_settings to service_role;

comment on table public.ea_instances is 'EA heartbeat registry. last_seen_at is server UTC; stale records do not prove the EA is running.';
comment on table public.ea_runtime_settings is 'Persistent symbol/strategy overrides. NULL inherits the current daily plan. Heartbeats never modify these settings.';
