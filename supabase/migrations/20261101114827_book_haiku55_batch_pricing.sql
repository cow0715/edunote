-- Pricing only. No resume, new AI calls, budget changes or checkpoint rewrites.
-- Apply to both DBs before deploying Haiku textbook routing.
begin;
create or replace function public.pdf_batch_token_cost(p_model text,p_usage jsonb)
returns numeric language sql immutable security invoker set search_path='' as $$
 select case when i>=0 and o>=0 and r>=0 and w>=0 then
  case regexp_replace(p_model,'-[0-9]{8}$','')
   when 'claude-haiku-5-5' then (i*0.05+o*0.25+r*0.005+w*0.0625)*(case when i+r+w>100000 then 5 else 1 end)/1000000
   when 'claude-sonnet-5-5' then (i+o*5+r*0.05+w*1.25)/1000000
   when 'claude-sonnet-5' then (i+o*5+r*0.1+w*1.25)/1000000
   when 'claude-opus-5-5' then (i*2+o*10+r*0.1+w*2.5)/1000000
   when 'claude-opus-5' then (i*2.5+o*12.5+r*0.25+w*3.125)/1000000
   when 'claude-sonnet-4-6' then (i*1.5+o*7.5+r*0.15+w*1.875)/1000000
   when 'claude-haiku-4-5' then (i*0.5+o*2.5+r*0.05+w*0.625)/1000000 end end
 from (select (p_usage->>'inputTokens')::numeric i,(p_usage->>'outputTokens')::numeric o,
  (p_usage->>'cacheReadTokens')::numeric r,(p_usage->>'cacheWriteTokens')::numeric w) t;
$$;

-- A group containing many short prompts must not pay the long-prompt rate.
-- Return Haiku's per-event sum alongside the unchanged summary columns.
drop function if exists public.cost_usage_summary(timestamptz,timestamptz,text);
create function public.cost_usage_summary(p_start timestamptz,p_end timestamptz,p_environment text)
returns table(provider text,feature text,model text,calls bigint,units numeric,input_tokens numeric,output_tokens numeric,cache_read_tokens numeric,cache_write_tokens numeric,service_tier text,estimated_usd numeric)
language sql stable security invoker set search_path='' as $$
 select e.provider,e.feature,e.model,count(*),sum(e.units),sum(e.input_tokens),sum(e.output_tokens),sum(e.cache_read_tokens),sum(e.cache_write_tokens),e.service_tier,
  case when e.provider='claude' and regexp_replace(e.model,'-[0-9]{8}$','')='claude-haiku-5-5' then
   sum(public.pdf_batch_token_cost(e.model,jsonb_build_object('inputTokens',e.input_tokens,'outputTokens',e.output_tokens,
    'cacheReadTokens',e.cache_read_tokens,'cacheWriteTokens',e.cache_write_tokens))*(case when e.service_tier='batch' then 1 else 2 end)) end
 from public.cost_usage_event e where e.occurred_at>=p_start and e.occurred_at<p_end and e.environment=p_environment
 group by e.provider,e.feature,e.model,e.service_tier;
$$;
revoke all on function public.pdf_batch_token_cost(text,jsonb),public.cost_usage_summary(timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.pdf_batch_token_cost(text,jsonb),public.cost_usage_summary(timestamptz,timestamptz,text) to service_role;
commit;
