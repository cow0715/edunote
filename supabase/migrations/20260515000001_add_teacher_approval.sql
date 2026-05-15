alter table teacher
  add column if not exists approval_status text not null default 'pending',
  add column if not exists is_admin boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references teacher(id) on delete set null;

alter table teacher
  drop constraint if exists teacher_approval_status_check;

alter table teacher
  add constraint teacher_approval_status_check
  check (approval_status in ('pending', 'approved', 'blocked'));

update teacher
set
  approval_status = 'approved',
  is_admin = true,
  approved_at = coalesce(approved_at, now())
where approval_status = 'pending';
