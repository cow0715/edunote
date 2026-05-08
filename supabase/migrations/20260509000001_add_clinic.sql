-- Clinic supplementary class management.
-- Clinic attendance is intentionally separate from regular class attendance.

create table if not exists clinic_slot (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teacher(id) on delete cascade,
  weekday text not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  starts_at time not null,
  ends_at time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, weekday),
  check (ends_at > starts_at)
);

create table if not exists clinic_enrollment (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teacher(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  clinic_slot_id uuid not null references clinic_slot(id) on delete cascade,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create unique index if not exists idx_clinic_enrollment_one_active
  on clinic_enrollment(teacher_id, student_id)
  where end_date is null;

create index if not exists idx_clinic_enrollment_slot_active
  on clinic_enrollment(clinic_slot_id, end_date);

create table if not exists clinic_attendance (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teacher(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  clinic_slot_id uuid not null references clinic_slot(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, student_id, date)
);

create index if not exists idx_clinic_attendance_teacher_date
  on clinic_attendance(teacher_id, date);

create or replace function update_clinic_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clinic_slot_updated_at on clinic_slot;
create trigger trg_clinic_slot_updated_at
  before update on clinic_slot
  for each row execute function update_clinic_updated_at();

drop trigger if exists trg_clinic_enrollment_updated_at on clinic_enrollment;
create trigger trg_clinic_enrollment_updated_at
  before update on clinic_enrollment
  for each row execute function update_clinic_updated_at();

drop trigger if exists trg_clinic_attendance_updated_at on clinic_attendance;
create trigger trg_clinic_attendance_updated_at
  before update on clinic_attendance
  for each row execute function update_clinic_updated_at();

alter table clinic_slot enable row level security;
alter table clinic_enrollment enable row level security;
alter table clinic_attendance enable row level security;

drop policy if exists "clinic_slot_owner" on clinic_slot;
create policy "clinic_slot_owner" on clinic_slot
  for all using (
    teacher_id in (select id from teacher where auth_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teacher where auth_id = auth.uid())
  );

drop policy if exists "clinic_enrollment_owner" on clinic_enrollment;
create policy "clinic_enrollment_owner" on clinic_enrollment
  for all using (
    teacher_id in (select id from teacher where auth_id = auth.uid())
    and exists (
      select 1
      from student s
      where s.id = clinic_enrollment.student_id
        and s.teacher_id = clinic_enrollment.teacher_id
    )
    and exists (
      select 1
      from clinic_slot cs
      where cs.id = clinic_enrollment.clinic_slot_id
        and cs.teacher_id = clinic_enrollment.teacher_id
    )
  )
  with check (
    teacher_id in (select id from teacher where auth_id = auth.uid())
    and exists (
      select 1
      from student s
      where s.id = clinic_enrollment.student_id
        and s.teacher_id = clinic_enrollment.teacher_id
    )
    and exists (
      select 1
      from clinic_slot cs
      where cs.id = clinic_enrollment.clinic_slot_id
        and cs.teacher_id = clinic_enrollment.teacher_id
    )
  );

drop policy if exists "clinic_attendance_owner" on clinic_attendance;
create policy "clinic_attendance_owner" on clinic_attendance
  for all using (
    teacher_id in (select id from teacher where auth_id = auth.uid())
    and exists (
      select 1
      from student s
      where s.id = clinic_attendance.student_id
        and s.teacher_id = clinic_attendance.teacher_id
    )
    and exists (
      select 1
      from clinic_slot cs
      where cs.id = clinic_attendance.clinic_slot_id
        and cs.teacher_id = clinic_attendance.teacher_id
    )
  )
  with check (
    teacher_id in (select id from teacher where auth_id = auth.uid())
    and exists (
      select 1
      from student s
      where s.id = clinic_attendance.student_id
        and s.teacher_id = clinic_attendance.teacher_id
    )
    and exists (
      select 1
      from clinic_slot cs
      where cs.id = clinic_attendance.clinic_slot_id
        and cs.teacher_id = clinic_attendance.teacher_id
    )
  );
