alter table message_log
  add column if not exists message_type text not null default 'weekly',
  add column if not exists mock_exam_id uuid null references mock_exam(id) on delete set null,
  add column if not exists mock_exam_report_id uuid null references mock_exam_report(id) on delete set null,
  add column if not exists recipient_label text null,
  add column if not exists phone text null,
  add column if not exists status text not null default 'sent',
  add column if not exists error_message text null;

create index if not exists idx_message_log_message_type on message_log(message_type);
create index if not exists idx_message_log_mock_exam_id on message_log(mock_exam_id);
create index if not exists idx_message_log_mock_exam_report_id on message_log(mock_exam_report_id);
