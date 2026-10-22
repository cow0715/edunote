-- Current DB/Storage measurements, accessible only to the server role.
create or replace function public.cost_infrastructure_usage()
returns table(db_bytes bigint, storage_bytes numeric, files bigint)
language sql stable security invoker set search_path = '' as $$
  select pg_catalog.pg_database_size(pg_catalog.current_database()),
    coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end),0),
    count(*) from storage.objects;
$$;
revoke all on function public.cost_infrastructure_usage() from public,anon,authenticated;
grant execute on function public.cost_infrastructure_usage() to service_role;
