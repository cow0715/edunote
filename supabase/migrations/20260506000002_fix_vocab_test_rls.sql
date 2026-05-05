create or replace function public.is_vocab_week_owner(p_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from week w
    join class c on c.id = w.class_id
    join teacher t on t.id = c.teacher_id
    where w.id = p_week_id
      and t.auth_id = auth.uid()
  );
$$;

grant execute on function public.is_vocab_week_owner(uuid) to authenticated;

drop policy if exists "vocab_test_owner" on vocab_test;
create policy "vocab_test_owner" on vocab_test
  for all
  using (public.is_vocab_week_owner(week_id))
  with check (public.is_vocab_week_owner(week_id));

drop policy if exists "vocab_test_item_owner" on vocab_test_item;
create policy "vocab_test_item_owner" on vocab_test_item
  for all
  using (
    exists (
      select 1
      from vocab_test vt
      where vt.id = vocab_test_item.vocab_test_id
        and public.is_vocab_week_owner(vt.week_id)
    )
  )
  with check (
    exists (
      select 1
      from vocab_test vt
      where vt.id = vocab_test_item.vocab_test_id
        and public.is_vocab_week_owner(vt.week_id)
    )
  );
