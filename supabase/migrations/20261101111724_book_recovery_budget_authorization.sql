-- A private, immutable operator approval extends ONLY its exact four-file
-- recovery bundle. Normal registration still inserts NULL and remains <= $20.
begin;
alter table public.book_pdf_bundle add column if not exists recovery_authorization jsonb;

create or replace function public.book_pdf_recovery_budget_valid(p_auth jsonb,p_files jsonb,p_limit numeric)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; total numeric=0; n integer=0;
begin
 if p_limit is null or p_limit<=0 then return false; end if;
 if p_auth is null then return p_limit<=20; end if;
 if jsonb_typeof(p_auth) is distinct from 'object' or p_auth->>'kind' is distinct from 'existing-job-recovery-v1'
  or p_auth->'bundle_files' is distinct from p_files or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)<>4
  or jsonb_typeof(p_auth->'jobs') is distinct from 'array' or jsonb_array_length(p_auth->'jobs')<>4
  or (p_auth->>'total_limit_usd')::numeric is distinct from 49::numeric or p_limit>49
  or coalesce(p_auth->>'approval_id','') !~ '^[a-f0-9-]{36}$' then return false; end if;
 for item in select value from jsonb_array_elements(p_auth->'jobs') loop
  if (item->>'position')::int is distinct from n or coalesce(item->>'job_id','') !~ '^[a-f0-9-]{36}$'
   or coalesce(item->>'document_id','') !~ '^[a-f0-9-]{36}$'
   or coalesce(item->>'pdf_hash','') !~ '^[a-f0-9]{64}$'
   or (item->>'limit_usd')::numeric is distinct from (array[14,9,12,14])[n+1] then return false; end if;
  total=total+(item->>'limit_usd')::numeric;n=n+1;
 end loop;
 return total=49 and (select count(distinct x->>'job_id')=4 and count(distinct x->>'document_id')=4 from jsonb_array_elements(p_auth->'jobs') x);
exception when others then return false;
end $$;
alter table public.book_pdf_bundle drop constraint if exists book_pdf_bundle_limit_usd_check;
alter table public.book_pdf_bundle add constraint book_pdf_bundle_limit_usd_check
 check(public.book_pdf_recovery_budget_valid(recovery_authorization,files,limit_usd));

create or replace function public.book_pdf_recovery_binding_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare approval jsonb; expected jsonb;
begin
 if tg_table_name='book_pdf_bundle' then
  if old.recovery_authorization is not null and
   (old.recovery_authorization is distinct from new.recovery_authorization or old.files is distinct from new.files
    or old.teacher_id is distinct from new.teacher_id or old.request_key is distinct from new.request_key)
   then raise exception 'recovery approval is immutable'; end if;
 else
  select recovery_authorization into approval from public.book_pdf_bundle where id=new.bundle_id;
  if approval is not null then
   expected=approval->'jobs'->new.position;
   if expected is null or expected->>'document_id' is distinct from new.document_id::text
    or expected->>'job_id' is distinct from new.job_id::text
    or expected->>'pdf_hash' is distinct from (select source_sha256 from public.book_pdf_document where id=new.document_id)
    then raise exception 'recovery file binding is immutable'; end if;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists book_pdf_recovery_bundle_binding on public.book_pdf_bundle;
create trigger book_pdf_recovery_bundle_binding before update on public.book_pdf_bundle
 for each row execute function public.book_pdf_recovery_binding_guard();
drop trigger if exists book_pdf_recovery_file_binding on public.book_pdf_bundle_file;
create trigger book_pdf_recovery_file_binding before insert or update on public.book_pdf_bundle_file
 for each row execute function public.book_pdf_recovery_binding_guard();
revoke all on function public.book_pdf_recovery_budget_valid(jsonb,jsonb,numeric),public.book_pdf_recovery_binding_guard() from public,anon,authenticated;
grant execute on function public.book_pdf_recovery_budget_valid(jsonb,jsonb,numeric),public.book_pdf_recovery_binding_guard() to service_role;
commit;
