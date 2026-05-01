-- =============================================================================
-- AdvisoryHub: Consolidate match_library function versions
-- =============================================================================
-- Date:    May 2026
-- Covers:  Card #263 (consolidate three match_library versions into one)
--          Schema support for Card #262 (tiered retrieval thresholds)
--
-- Background
-- ----------
-- The database had THREE versions of match_library coexisting due to
-- PostgreSQL function overloading:
--
--   1. (vector, double, integer)                        -- original 3-arg
--   2. (vector, double, integer, uuid[])                -- project link table version
--   3. (vector, double, integer, uuid, uuid)            -- direct project_id version (in use)
--
-- chat.js calls version 3 via named arguments (p_user_id, p_project_id).
-- Versions 1 and 2 were dead code. Version 3 returned id, title, content,
-- source_url, similarity but chat.js filter logic expects category and
-- project_id, so the existing skill/framework/project-doc separation was
-- silently broken.
--
-- This migration drops all three versions, then creates a single canonical
-- version with the extended return columns.
--
-- Important: PostgreSQL does not allow CREATE OR REPLACE FUNCTION to change
-- the return type. The function MUST be dropped first, then created fresh.
-- This is why the migration uses DROP FUNCTION then CREATE FUNCTION rather
-- than CREATE OR REPLACE.
--
-- Idempotent. Each DROP uses IF EXISTS with the exact signature so it only
-- targets the intended overload. The CREATE will fail if the function
-- already exists, which is the desired behaviour because it forces a clean
-- state. To re-run after partial application, drop the surviving version
-- manually first.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Drop all three existing versions
-- Each DROP targets the exact signature so PostgreSQL knows which overload.
-- -----------------------------------------------------------------------------

drop function if exists public.match_library(
  query_embedding vector,
  match_threshold double precision,
  match_count integer
);

drop function if exists public.match_library(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  filter_project_ids uuid[]
);

drop function if exists public.match_library(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_user_id uuid,
  p_project_id uuid
);

-- -----------------------------------------------------------------------------
-- Create the single canonical version
-- Returns id, title, category, content, source_url, project_id, similarity.
-- The category and project_id columns are required by chat.js for skill,
-- framework, and project-doc separation in status messages and prompt
-- assembly.
-- -----------------------------------------------------------------------------

create function public.match_library(
  query_embedding vector,
  match_threshold double precision default 0.7,
  match_count integer default 5,
  p_user_id uuid default null,
  p_project_id uuid default null
)
returns table (
  id uuid,
  title text,
  category text,
  content text,
  source_url text,
  project_id uuid,
  similarity double precision
)
language sql
stable
as $$
  select
    library_documents.id,
    library_documents.title,
    library_documents.category,
    library_documents.content,
    library_documents.source_url,
    library_documents.project_id,
    1 - (library_documents.embedding <=> query_embedding) as similarity
  from library_documents
  where (
    -- Admin/global documents: no user, default enabled
    (library_documents.user_id is null and library_documents.default_enabled = true)
    -- User's own personal library documents
    or (p_user_id is not null and library_documents.user_id = p_user_id)
    -- Project-scoped documents for the active project
    or (p_project_id is not null and library_documents.project_id = p_project_id)
  )
  and 1 - (library_documents.embedding <=> query_embedding) > match_threshold
  order by library_documents.embedding <=> query_embedding
  limit match_count;
$$;

commit;

-- =============================================================================
-- Verification (run separately after commit)
-- =============================================================================
--
-- 1. Confirm only one match_library function exists now:
-- select proname, pg_get_function_arguments(oid)
-- from pg_proc
-- where proname = 'match_library';
--
-- Expect a single row with arguments:
--   query_embedding vector, match_threshold double precision DEFAULT 0.7,
--   match_count integer DEFAULT 5, p_user_id uuid DEFAULT NULL,
--   p_project_id uuid DEFAULT NULL
--
-- 2. Confirm the function returns category and project_id:
-- select pg_get_function_result(oid)
-- from pg_proc
-- where proname = 'match_library';
--
-- Expect: TABLE(id uuid, title text, category text, content text,
-- source_url text, project_id uuid, similarity double precision)
-- =============================================================================
