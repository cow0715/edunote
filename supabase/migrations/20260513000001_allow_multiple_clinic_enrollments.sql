-- Allow a student to attend multiple weekly clinic days.
-- A student can still have only one active enrollment per clinic slot.

drop index if exists idx_clinic_enrollment_one_active;

create unique index if not exists idx_clinic_enrollment_one_active_per_slot
  on clinic_enrollment(teacher_id, student_id, clinic_slot_id)
  where end_date is null;
