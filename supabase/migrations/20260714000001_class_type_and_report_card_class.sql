-- 특강반 지원: 수업 구분 + 성적표 반별 분리
-- class.class_type: 'regular'(정규반) / 'special'(특강반)
alter table class add column if not exists class_type text not null default 'regular'
  check (class_type in ('regular', 'special'));

-- report_card.class_id: 반별 성적표. null이면 기존(전체 합산) 방식으로 렌더링
alter table report_card add column if not exists class_id uuid references class(id) on delete cascade;

create index if not exists idx_report_card_class_id on report_card(class_id);
