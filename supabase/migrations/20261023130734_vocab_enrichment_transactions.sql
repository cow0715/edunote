-- Shared dictionary cache: no student or teacher-specific data.
-- Preserve existing policies/triggers; only the app driver gains the same dictionary access.
begin;
alter table public.vocab_variant_cache enable row level security;
grant select, insert, update on public.vocab_variant_cache to edunote_app;
drop policy if exists edunote_app_variant_cache_scope on public.vocab_variant_cache;
create policy edunote_app_variant_cache_scope on public.vocab_variant_cache as restrictive for all to edunote_app
  using (exists(select 1 from public.teacher where auth_id=(select auth.uid()) and approval_status='approved'))
  with check (exists(select 1 from public.teacher where auth_id=(select auth.uid()) and approval_status='approved'));
commit;
