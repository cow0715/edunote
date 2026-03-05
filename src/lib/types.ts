export interface Teacher {
  id: string;
  auth_id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Student {
  id: string;
  teacher_id: string;
  name: string;
  phone: string | null;
  parent_phone: string | null;
  school: string | null;
  grade: string | null;
  memo: string | null;
  share_token: string;
  created_at: string;
}

export interface Class {
  id: string;
  teacher_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface ClassStudent {
  id: string;
  class_id: string;
  student_id: string;
  created_at: string;
  student?: Student;
}

export interface Week {
  id: string;
  class_id: string;
  week_number: number;
  start_date: string | null;
  vocab_total: number;
  homework_total: number;
  created_at: string;
}

export interface QuestionType {
  id: string;
  teacher_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ConceptCategory {
  id: string;
  teacher_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ConceptTag {
  id: string;
  teacher_id: string;
  concept_category_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  concept_category?: ConceptCategory;
}

export interface ExamQuestionChoice {
  id: string;
  exam_question_id: string;
  choice_number: number;
  concept_tag_id: string;
  concept_tag?: ConceptTag;
}

export interface ExamQuestion {
  id: string;
  week_id: string;
  question_number: number;
  correct_answer: number;
  question_type_id: string | null;
  concept_tag_id: string | null;
  exam_type: 'vocab' | 'reading';
  created_at: string;
  question_type?: QuestionType;
  concept_tag?: ConceptTag;
  exam_question_choice?: ExamQuestionChoice[];
}

export interface WeekScore {
  id: string;
  week_id: string;
  student_id: string;
  vocab_correct: number;
  homework_done: number;
  memo: string | null;
  created_at: string;
  student?: Student;
}

export interface StudentAnswer {
  id: string;
  week_score_id: string;
  exam_question_id: string;
  student_answer: number | null;
  is_correct: boolean;
  created_at: string;
  exam_question?: ExamQuestion;
}

// 채점 현황 조회용 집계 타입
export interface WeekScoreSummary {
  student_id: string;
  student_name: string;
  week_score_id: string | null;
  reading_correct: number;
  reading_total: number;
  vocab_correct: number;
  vocab_total: number;
  homework_done: number;
  homework_total: number;
  is_scored: boolean;
}

// 학부모 대시보드용 타입
export interface ShareData {
  student: Student;
  classes: Array<{
    class: Class;
    weeks: Array<{
      week: Week;
      score: WeekScore | null;
      answers: StudentAnswer[];
      questions: ExamQuestion[];
    }>;
  }>;
  question_types: QuestionType[];
}
