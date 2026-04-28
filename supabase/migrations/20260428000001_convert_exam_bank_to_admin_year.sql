-- Convert exam_bank.exam_year from academic year to administered year.
-- Example: 2026학년도 수능/6월/9월 -> 2025년 시행 시험.

update exam_bank
set exam_year = exam_year - 1;

update exam_bank
set title = case
  when source = '수능' or exam_month = 11 then exam_year || '년 ' || exam_month || '월 수능'
  else exam_year || '년 ' || exam_month || '월 고' || grade || ' 모의고사'
end
where title ~ '^[0-9]{4}(년|년도|학년도) 수능$'
   or title ~ '^[0-9]{4}(년|년도|학년도) [0-9]{1,2}월 수능$'
   or title ~ '^[0-9]{4}(년|년도|학년도) [0-9]{1,2}월 고[1-3] 모의고사$';

comment on column exam_bank.exam_year is '시행년도';
