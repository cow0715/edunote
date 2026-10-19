import { boolean, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Query mappings only. supabase/migrations remains the schema authority.
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

export const teachers = pgTable('teacher', {
  id: uuid().primaryKey(),
  auth_id: uuid().notNull(),
  approval_status: text().notNull(),
})

export const classes = pgTable('class', {
  id: uuid().primaryKey().defaultRandom(),
  teacher_id: uuid().notNull(),
  name: text().notNull(),
  description: text(),
  start_date: date().notNull(),
  end_date: date().notNull(),
  schedule_days: text().array().default([]),
  created_at: time('created_at').defaultNow(),
  academic_year: integer(),
  school_name: text(),
  grade_level: integer(),
  archived_at: time('archived_at'),
  class_type: text().notNull().default('regular'),
})

export const periods = pgTable('class_period', {
  id: uuid().primaryKey().defaultRandom(),
  class_id: uuid().notNull(),
  label: text().notNull(),
  semester: integer().notNull(),
  exam_type: text().notNull().default('other'),
  start_date: date().notNull(),
  end_date: date(),
  is_current: boolean().notNull().default(false),
  sort_order: integer().notNull().default(0),
  created_at: time('created_at').notNull().defaultNow(),
  updated_at: time('updated_at').notNull().defaultNow(),
})

export const weeks = pgTable('week', {
  id: uuid().primaryKey().defaultRandom(),
  class_id: uuid().notNull(),
  week_number: integer().notNull(),
  start_date: date(),
  vocab_total: integer().default(0),
  reading_total: integer().default(0),
  homework_total: integer().default(0),
  answer_sheet_path: text(),
  created_at: time('created_at').defaultNow(),
  vocab_source_type: text().notNull().default('legacy'),
  vocab_source_file_name: text(),
  vocab_source_uploaded_at: time('vocab_source_uploaded_at'),
  vocab_examples_generated_at: time('vocab_examples_generated_at'),
})
