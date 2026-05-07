update week w
set vocab_total = 0
where coalesce(w.vocab_source_type, 'legacy') <> 'legacy'
  and not exists (
    select 1
    from vocab_test vt
    where vt.week_id = w.id
      and vt.is_active = true
  );
