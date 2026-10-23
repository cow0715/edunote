-- Remove the obsolete, unattached class-to-week generation trigger function.
-- Safe on development (where it is absent) and production.
-- RESTRICT intentionally fails if a dependency has been added since the audit.
-- Keep all active triggers, RLS helpers, and RPC functions unchanged.
drop function if exists public.generate_weeks() restrict;
