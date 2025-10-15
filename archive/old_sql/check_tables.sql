-- Query to check existing table structures
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name IN ('ea-log', 'ai_config', 'ai_signals')
ORDER BY table_name, ordinal_position;
