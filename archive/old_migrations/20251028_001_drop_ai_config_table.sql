-- Migration: Drop ai_config table
-- Reason: ai_config is no longer used. All parameters are managed via EA input properties.
-- Created: 2025-10-28

-- Drop ai_config table
DROP TABLE IF EXISTS public.ai_config CASCADE;

-- Remove any related indexes (should be auto-dropped with CASCADE, but being explicit)
-- Note: Indexes are automatically dropped with the table

COMMENT ON SCHEMA public IS 'ai_config table removed - all config now managed via EA properties';
