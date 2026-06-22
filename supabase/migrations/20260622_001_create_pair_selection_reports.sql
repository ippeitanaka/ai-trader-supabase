CREATE TABLE IF NOT EXISTS public.pair_selection_reports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cadence TEXT NOT NULL DEFAULT 'daily',
  timeframe TEXT NOT NULL DEFAULT 'M15',
  lookback_days INTEGER NOT NULL DEFAULT 21,
  top_n INTEGER NOT NULL DEFAULT 3,
  universe TEXT[] NOT NULL,
  selected_pairs JSONB NOT NULL,
  avoided_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_stats JSONB NOT NULL,
  summary TEXT,
  model TEXT,
  triggered_by TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_pair_selection_reports_created_at
  ON public.pair_selection_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pair_selection_reports_status_created_at
  ON public.pair_selection_reports (status, created_at DESC);

CREATE OR REPLACE VIEW public.latest_pair_selection_report AS
SELECT *
FROM public.pair_selection_reports
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 1;

COMMENT ON TABLE public.pair_selection_reports IS 'AIが現在のシステム相性に基づいて選定した推奨トレード対象ペアのレポート';
COMMENT ON VIEW public.latest_pair_selection_report IS '最新の有効なペア選定レポート';

ALTER TABLE public.pair_selection_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to pair_selection_reports" ON public.pair_selection_reports;
DROP POLICY IF EXISTS "Allow read access to pair_selection_reports" ON public.pair_selection_reports;

CREATE POLICY "Allow service role full access to pair_selection_reports"
  ON public.pair_selection_reports FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow read access to pair_selection_reports"
  ON public.pair_selection_reports FOR SELECT
  USING (true);

GRANT SELECT ON public.latest_pair_selection_report TO authenticated, service_role, anon;
GRANT SELECT ON public.pair_selection_reports TO authenticated, service_role, anon;
