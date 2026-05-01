-- =============================================================================
-- AdvisoryHub Phase 1 Schema Migration
-- =============================================================================
-- Date:    May 2026
-- Covers:  Card #241 (Configuration Presets tables)
--          Card #250 (DISC Assessments table)
--          Card #252 (Operational Preferences profile columns)
--          Project additions (default_persona_reviewer, preference_overrides)
--
-- Idempotent. Safe to re-run. Uses IF NOT EXISTS for tables and columns,
-- and DROP POLICY IF EXISTS for RLS policies.
--
-- Apply via Supabase SQL Editor in a single execution. Wrapped in a
-- transaction so any failure rolls back the whole batch.
--
-- Companion seed file: /server/db/seed-presets.sql (run AFTER this file).
-- Rollback block at bottom (commented out).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- CARD #241: Configuration Presets tables
-- -----------------------------------------------------------------------------

create table if not exists public.configuration_presets (
  id uuid default gen_random_uuid() primary key,
  archetype_key text unique not null,
  name text not null,
  description text,
  preferences jsonb not null,
  is_built_in boolean default true,
  created_at timestamptz default now()
);

alter table public.configuration_presets enable row level security;

drop policy if exists "All authenticated users can read presets"
  on public.configuration_presets;
create policy "All authenticated users can read presets"
  on public.configuration_presets for select
  using (auth.role() = 'authenticated');

create table if not exists public.user_presets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  preferences jsonb not null,
  voice_markers_included boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_presets enable row level security;

drop policy if exists "Users can manage own presets"
  on public.user_presets;
create policy "Users can manage own presets"
  on public.user_presets for all
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- CARD #250: DISC Assessments table
-- -----------------------------------------------------------------------------

create table if not exists public.disc_assessments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  completed_at timestamptz default now(),
  d_score integer not null check (d_score between 0 and 100),
  i_score integer not null check (i_score between 0 and 100),
  s_score integer not null check (s_score between 0 and 100),
  c_score integer not null check (c_score between 0 and 100),
  primary_quadrant text not null check (primary_quadrant in ('D','I','S','C')),
  secondary_quadrant text check (secondary_quadrant in ('D','I','S','C')),
  raw_responses jsonb not null
);

alter table public.disc_assessments enable row level security;

drop policy if exists "Users can manage own DISC assessments"
  on public.disc_assessments;
create policy "Users can manage own DISC assessments"
  on public.disc_assessments for all
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- CARD #252: Operational Preferences profile columns
-- -----------------------------------------------------------------------------
-- Adds 32 columns to public.profiles covering identity, working style,
-- audience and artefacts, memory and continuity, voice and language,
-- and tracking flags. All with sensible defaults so existing users are
-- migrated automatically without data loss.
-- -----------------------------------------------------------------------------

alter table public.profiles
  -- Identity expansion
  add column if not exists jurisdiction text default 'Queensland',
  add column if not exists industry text[],
  add column if not exists seniority text,
  add column if not exists years_in_domain integer,
  -- Working style preferences
  add column if not exists default_stance text default 'neutral',
  add column if not exists output_density text default 'mixed',
  add column if not exists tone_register text default 'plain_professional',
  add column if not exists uncertainty_handling text default 'hedge_briefly',
  add column if not exists failure_mode_default text default 'on_request',
  add column if not exists affirmation_level text default 'allowed_when_warranted',
  add column if not exists length_default text default 'medium',
  add column if not exists citation_density text default 'moderate',
  add column if not exists clarification_style text default 'ask_if_material',
  add column if not exists australian_english boolean default true,
  -- Audience and artefacts
  add column if not exists default_artefact text default 'briefing_note',
  add column if not exists pushback_explicitness text default 'explicit',
  add column if not exists default_persona_reviewer text,
  add column if not exists self_audit_enabled boolean default true,
  add column if not exists prompt_strengthening_visibility text default 'silent',
  -- Memory and continuity
  add column if not exists auto_pin text default 'conservative',
  add column if not exists cross_project_memory boolean default false,
  add column if not exists session_freshness text default 'pull_prior',
  -- Voice and language
  add column if not exists banned_words text,
  add column if not exists confidentiality_redactions text,
  add column if not exists preferred_methodologies jsonb,
  add column if not exists voice_markers jsonb,
  add column if not exists anti_pattern_markers jsonb,
  -- Tracking flags
  add column if not exists disc_completed boolean default false,
  add column if not exists disc_skipped boolean default false,
  add column if not exists applied_preset text,
  add column if not exists show_alignment_score boolean default true,
  add column if not exists conversational_context_building boolean default true;

-- -----------------------------------------------------------------------------
-- Project-level preference overrides
-- -----------------------------------------------------------------------------
-- Adds default_persona_reviewer and preference_overrides to projects so
-- a project can override one or more profile-level preferences without
-- losing the global default. preference_overrides is a jsonb keyed by
-- preference column name, e.g. {"length_default":"long","tone_register":"formal_precise"}.
-- -----------------------------------------------------------------------------

alter table public.projects
  add column if not exists default_persona_reviewer text,
  add column if not exists preference_overrides jsonb default '{}'::jsonb;

commit;

-- =============================================================================
-- Verification (run separately, not inside the transaction)
-- =============================================================================
-- After commit, run these to confirm shape:
--
-- select count(*) from public.configuration_presets;
-- select count(*) from public.user_presets;
-- select count(*) from public.disc_assessments;
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--   order by ordinal_position;
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'projects'
--   order by ordinal_position;
-- =============================================================================

-- =============================================================================
-- ROLLBACK BLOCK (commented out)
-- =============================================================================
-- Uncomment and run the entire block to undo this migration. Note: this
-- drops all data in the new tables and removes the new profile columns.
-- =============================================================================
--
-- begin;
--
-- drop table if exists public.user_presets;
-- drop table if exists public.configuration_presets;
-- drop table if exists public.disc_assessments;
--
-- alter table public.profiles
--   drop column if exists conversational_context_building,
--   drop column if exists show_alignment_score,
--   drop column if exists applied_preset,
--   drop column if exists disc_skipped,
--   drop column if exists disc_completed,
--   drop column if exists anti_pattern_markers,
--   drop column if exists voice_markers,
--   drop column if exists preferred_methodologies,
--   drop column if exists confidentiality_redactions,
--   drop column if exists banned_words,
--   drop column if exists session_freshness,
--   drop column if exists cross_project_memory,
--   drop column if exists auto_pin,
--   drop column if exists prompt_strengthening_visibility,
--   drop column if exists self_audit_enabled,
--   drop column if exists default_persona_reviewer,
--   drop column if exists pushback_explicitness,
--   drop column if exists default_artefact,
--   drop column if exists australian_english,
--   drop column if exists clarification_style,
--   drop column if exists citation_density,
--   drop column if exists length_default,
--   drop column if exists affirmation_level,
--   drop column if exists failure_mode_default,
--   drop column if exists uncertainty_handling,
--   drop column if exists tone_register,
--   drop column if exists output_density,
--   drop column if exists default_stance,
--   drop column if exists years_in_domain,
--   drop column if exists seniority,
--   drop column if exists industry,
--   drop column if exists jurisdiction;
--
-- alter table public.projects
--   drop column if exists preference_overrides,
--   drop column if exists default_persona_reviewer;
--
-- commit;
-- =============================================================================
