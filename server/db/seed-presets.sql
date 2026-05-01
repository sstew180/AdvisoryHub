-- =============================================================================
-- AdvisoryHub Configuration Presets Seed Data
-- =============================================================================
-- Date:    May 2026
-- Covers:  Card #242 (Configuration Presets seed data for five archetypes)
--
-- Run AFTER /server/db/migrations/2026_05_phase1_schema.sql.
-- Idempotent. Uses ON CONFLICT (archetype_key) DO UPDATE so re-running
-- this file refreshes the preset content without duplicating rows.
-- This makes it safe to update preference values later and re-run.
--
-- The five archetypes are: Director, Storyteller, Auditor, Pragmatist, Coach.
-- Each preferences jsonb maps directly onto profile columns added in the
-- Phase 1 schema migration.
-- =============================================================================

insert into public.configuration_presets
  (archetype_key, name, description, preferences, is_built_in)
values

  -- ---------------------------------------------------------------------------
  -- DIRECTOR: Short, direct, challenge-led output. Decisions over discussion.
  -- ---------------------------------------------------------------------------
  ('director',
   'The Director',
   'Short, direct, challenge-led output. Decisions over discussion.',
   '{
     "default_stance": "challenge",
     "output_density": "scannable",
     "tone_register": "formal_direct",
     "length_default": "short",
     "affirmation_level": "zero",
     "failure_mode_default": "always",
     "clarification_style": "assume_and_flag",
     "citation_density": "light",
     "uncertainty_handling": "ranges"
   }'::jsonb,
   true),

  -- ---------------------------------------------------------------------------
  -- STORYTELLER: Conversational, narrative output that brings people along.
  -- ---------------------------------------------------------------------------
  ('storyteller',
   'The Storyteller',
   'Conversational, narrative output that brings people along.',
   '{
     "default_stance": "neutral",
     "output_density": "mixed",
     "tone_register": "conversational",
     "length_default": "medium",
     "affirmation_level": "conversational",
     "failure_mode_default": "on_request",
     "clarification_style": "ask_if_material",
     "citation_density": "moderate",
     "uncertainty_handling": "hedge_briefly"
   }'::jsonb,
   true),

  -- ---------------------------------------------------------------------------
  -- AUDITOR: Evidence-anchored output that survives scrutiny.
  -- ---------------------------------------------------------------------------
  ('auditor',
   'The Auditor',
   'Evidence-anchored output that survives scrutiny.',
   '{
     "default_stance": "challenge",
     "output_density": "dense",
     "tone_register": "formal_precise",
     "length_default": "long",
     "affirmation_level": "zero",
     "failure_mode_default": "always",
     "clarification_style": "ask_before_drafting",
     "citation_density": "heavy",
     "uncertainty_handling": "flag_every"
   }'::jsonb,
   true),

  -- ---------------------------------------------------------------------------
  -- PRAGMATIST: Balanced plain professional output. Reasoning visible.
  -- ---------------------------------------------------------------------------
  ('pragmatist',
   'The Pragmatist',
   'Balanced, plain professional output. Clear recommendations with reasoning visible.',
   '{
     "default_stance": "neutral",
     "output_density": "mixed",
     "tone_register": "plain_professional",
     "length_default": "medium",
     "affirmation_level": "warranted",
     "failure_mode_default": "on_request",
     "clarification_style": "ask_if_material",
     "citation_density": "moderate",
     "uncertainty_handling": "hedge_briefly"
   }'::jsonb,
   true),

  -- ---------------------------------------------------------------------------
  -- COACH: Considered well-paced output. Sequenced thinking, supportive framing.
  -- ---------------------------------------------------------------------------
  ('coach',
   'The Coach',
   'Considered, well-paced output. Sequenced thinking with supportive framing.',
   '{
     "default_stance": "support",
     "output_density": "mixed",
     "tone_register": "plain_professional",
     "length_default": "medium",
     "affirmation_level": "warranted",
     "failure_mode_default": "on_request",
     "clarification_style": "ask_before_drafting",
     "citation_density": "moderate",
     "uncertainty_handling": "acknowledge"
   }'::jsonb,
   true)

on conflict (archetype_key) do update
  set name        = excluded.name,
      description = excluded.description,
      preferences = excluded.preferences,
      is_built_in = excluded.is_built_in;

-- =============================================================================
-- Verification (run separately)
-- =============================================================================
-- select archetype_key, name, jsonb_pretty(preferences)
-- from public.configuration_presets
-- order by archetype_key;
--
-- Expect 5 rows: auditor, coach, director, pragmatist, storyteller.
-- =============================================================================
