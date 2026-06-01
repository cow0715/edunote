alter table report_card
  add column if not exists share_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists revoked_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'report_card_share_token_key'
  ) then
    alter table report_card add constraint report_card_share_token_key unique (share_token);
  end if;
end $$;

alter table message_log
  add column if not exists report_card_id uuid null references report_card(id) on delete set null;

create index if not exists idx_report_card_share_token on report_card(share_token);
create index if not exists idx_message_log_report_card_id on message_log(report_card_id);
