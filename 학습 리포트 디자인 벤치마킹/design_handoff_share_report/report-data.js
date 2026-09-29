// 정규화된 리포트 데이터. weeks는 오래된 → 최신 순.
// reading/vocab/homework 가 null 이면 그 주차에 해당 항목 없음. comment null = 코멘트 없음.
const Q = [
  { tag: '내용 일치', num: 3, mine: 3, stem: '다음 글의 내용과 일치하지 않는 것은?', passage: 'Diya pointed at the lake and shouted, "Come on, Ryanna!" Ryanna stood still. She was wearing her regular clothes—her bathing suit was still in her bag. Her chest felt tight, and her hands were trembling.', choices: ['Diya가 먼저 물에 들어가자고 외쳤다.', 'Ryanna는 수영복을 입고 있었다.', 'Ryanna의 손이 떨리고 있었다.', 'Ryanna는 뛰어들고 싶지 않았다.', 'Ryanna의 가방에 수영복이 있었다.'], answer: 1, explanation: '"her bathing suit was still in her bag" — 수영복은 가방 안에 있었고 평상복을 입고 있었습니다. ②가 본문과 반대.' },
  { tag: '내용 일치', num: 7, mine: 0, stem: '글에서 알 수 있는 Ryanna의 심리 상태는?', passage: 'Everyone was looking at her now, and it made her feel even worse. She wanted to run away, but she felt trapped, like the fear had frozen her.', choices: ['자신감', '두려움과 압박', '지루함', '분노', '안도감'], answer: 1, explanation: '"feel even worse", "wanted to run away", "fear had frozen her" 모두 두려움·압박의 근거 표현입니다.' },
  { tag: '빈칸 추론', num: 12, mine: 1, stem: '빈칸에 들어갈 말로 가장 적절한 것은?', passage: 'They just stood there, watching. Her heart beat faster. She felt like crying, but she did not want anyone to see. Especially not Diya. She felt ______.', choices: ['relieved', 'proud', 'exposed', 'bored', 'confident'], answer: 2, explanation: '"did not want anyone to see" — 시선에 노출된 느낌이므로 exposed.' },
  { tag: '관계사', num: 15, mine: 2, stem: '어법상 틀린 것은?', passage: 'She looked at the adults (a)standing on the dock, hoping someone would say, "It\'s okay." But no one did. They just stood there, (b)watched.', choices: ['(a) standing', '(b) watched', '둘 다 옳다', '둘 다 틀리다', '판단 불가'], answer: 1, explanation: '"stood there, watched"의 watched는 능동 의미이므로 watching.' },
  { tag: '빈칸 추론', num: 9, mine: 4, stem: '빈칸에 들어갈 말로 가장 적절한 것은?', passage: 'Habits are not formed by a single heroic effort but by ______ repetition — the same small act, day after day.', choices: ['sudden', 'painful', 'quiet', 'random', 'public'], answer: 2, explanation: '조용하고 눈에 띄지 않는 반복. quiet.' },
  { tag: '내용 일치', num: 5, mine: 1, stem: '다음 글의 내용과 일치하는 것은?', passage: 'The library opened in 1911 with just 400 books, most donated by local families. It moved to its current building in 1958 and now holds over 200,000 volumes.', choices: ['1911년에 지금 건물에서 개관했다.', '초기 장서는 대부분 기부받은 것이다.', '1958년에 문을 닫았다.', '현재 장서는 2만 권이다.', '개관 당시 4천 권을 보유했다.'], answer: 1, explanation: '"most donated by local families" — ②.' },
];
const W = [
  { word: 'exhibition plan', ko: '전시 계획', pos: 'n.', syn: ['display plan', 'showcase plan'], ant: [], mine: '박람일자', source: 'meaning' },
  { word: 'exhibit', ko: '전시하다', pos: 'v.', syn: ['display', 'showcase'], ant: ['hide', 'conceal'], mine: '박람하다', source: 'meaning' },
  { word: 'assign', ko: '할당하다', pos: 'v.', syn: ['allocate', 'designate'], ant: ['revoke'], mine: '마답', source: 'meaning' },
  { word: 'make out', ko: '알아보다 / 이해하다', pos: 'phr.', syn: ['discern', 'distinguish'], ant: [], mine: '마답', source: 'meaning' },
  { word: 'faint', ko: '희미하다', pos: 'adj.', syn: ['dim', 'vague'], ant: ['clear', 'vivid'], mine: '절절다', source: 'meaning' },
  { word: 'conceal', ko: '숨기다', pos: 'v.', syn: ['hide', 'cover'], ant: ['reveal'], mine: null, source: 'synonym', original: 'hide' },
  { word: 'revoke', ko: '취소하다, 철회하다', pos: 'v.', syn: ['withdraw', 'cancel'], ant: ['grant'], mine: null, source: 'antonym', original: 'grant' },
  { word: 'comprehend', ko: '이해하다', pos: 'v.', syn: ['grasp', 'understand'], ant: [], mine: null, source: 'derivative', original: 'comprehensive' },
];
const mockWeek = (label, date, reading, vocab, retake, hw, att, classAvg, wq, ww, comment) => ({
  period: '2026 봄', label, shortLabel: label, date, att,
  reading: reading ? { c: reading[0], t: reading[1], classAvg: classAvg[0] } : null,
  vocab: vocab ? { c: vocab[0], t: vocab[1], classAvg: classAvg[1], retake } : null,
  homework: { d: hw[0], t: hw[1] }, comment,
  wrongQ: wq.map(i => Q[i]), wrongW: ww.map(i => W[i]),
});

export const DATASETS = {
  '강상섭 (목업 · 6주)': {
    student: { name: '강상섭', headerLine: '1학년 · 숭문고 · 수능 고1반' },
    periods: [{ label: '2026 봄', isCurrent: true, start: '2026-03-01', end: null }],
    weeks: [
      mockWeek('1주차', '2026-03-06', [1, 4], [45, 50], [3, 5], [3, 4], 'present', [55, 70], [5], [5, 6, 7], '첫 주라 시험 유형 적응에 시간이 걸렸어요. 단어는 잘 외워옵니다.'),
      mockWeek('2주차', '2026-03-13', [2, 4], [20, 50], [20, 30], [4, 4], 'present', [60, 68], [4, 5], [2, 3, 4, 5, 6, 7], '독해는 올랐는데 단어를 안 봤어요. 다음 주 단어 시험 다시 봅니다.'),
      mockWeek('3주차', '2026-03-20', [3, 4], [30, 50], [16, 20], [2, 4], 'late', [62, 71], [0], [1, 2, 3, 4, 5], '지각 1회. 과제 절반만 제출. 내용 일치 문제를 반복해서 틀립니다.'),
      mockWeek('4주차', '2026-03-27', [4, 4], [28, 40], [8, 12], [8, 9], 'present', [65, 72], [], [0, 1, 2, 3], '독해 전 문항 정답. 빈칸 추론에서 근거 문장 찾는 연습 효과가 보여요.'),
      mockWeek('5주차', '2026-04-03', [3, 4], [37, 50], [10, 13], [9, 9], 'present', [64, 70], [2, 3], [3, 4, 5, 6, 7], '어휘 문항 정답률이 안정적으로 올라왔어요.'),
      mockWeek('6주차', '2026-04-10', [2, 4], [40, 52], [null, 12], [8, 9], 'present', [62, 71], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5, 6, 7], '시험은 내용 일치 2문항을 놓쳤어요. 단어는 3주 연속 상승이라 이 흐름을 유지하면 됩니다.'),
    ],
    attendance: {
      regular: { present: 6, total: 6, streak: 3 }, clinic: { present: 4, total: 5 },
      clinicDays: { '2026-03-10': 'present', '2026-03-17': 'absent', '2026-03-24': 'present', '2026-03-31': 'present', '2026-04-07': 'present' },
    },
    analysis: {
      types: [
        { name: '내용 일치', wrong: 6, total: 8, domain: '독해' }, { name: '빈칸 추론', wrong: 5, total: 12, domain: '독해' }, { name: '관계사', wrong: 3, total: 6, domain: '문법' },
        { name: '어휘', wrong: 4, total: 14, domain: '어휘' }, { name: '분사', wrong: 2, total: 5, domain: '문법' }, { name: '주제 찾기', wrong: 1, total: 7, domain: '독해' }, { name: '접속사/전치사', wrong: 2, total: 6, domain: '문법' },
      ],
      patterns: [
        { name: '내용 일치', state: 'persistent', weeks: [0, 0, null, 50, 0, 0], insight: '5회 출제 중 4회 오답 · 평균 20%' },
        { name: '빈칸 추론', state: 'deteriorating', weeks: [100, 100, 67, 50, 33, 33], insight: '최근 정답률 33% · 40%p 하락 추세' },
        { name: '관계사', state: 'unstable', weeks: [0, 100, null, 0, 100, 50], insight: '정답률 0%~100% 변동 · 평균 50%' },
        { name: '어휘', state: 'improving', weeks: [0, 33, 50, 67, 100, 75], insight: '50%p 상승 중 · 현재 75%' },
      ],
    },
  },

  '김동화 (고3 · 26주 · 시험 없음)': {
    student: { name: '김동화', headerLine: '3학년 · 수능 고 · 수능 고3반' },
    periods: [{ label: '시즌3', isCurrent: true, start: '2026-06-28', end: null }, { label: '시즌2', start: '2026-04-05', end: '2026-06-27' }, { label: '시즌1', start: '2026-01-11', end: '2026-04-04' }],
    weeks: [
      { period: '시즌2', label: '시즌2 11주차', shortLabel: '11주차', date: '2026-06-20', att: 'present', reading: { c: 12, t: 20, classAvg: 64 }, vocab: { c: 44, t: 50, classAvg: 86, retake: null }, homework: { d: 5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌2', label: '시즌2 12주차', shortLabel: '12주차', date: '2026-06-27', att: 'present', reading: { c: 11, t: 20, classAvg: 60 }, vocab: { c: 46, t: 50, classAvg: 88, retake: null }, homework: { d: 4, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 1주차', shortLabel: '1주차', date: '2026-06-28', att: 'present', reading: null, vocab: { c: 46, t: 50, classAvg: 90, retake: null }, homework: { d: 5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 3주차', shortLabel: '3주차', date: '2026-07-12', att: 'present', reading: null, vocab: { c: 42, t: 50, classAvg: 85, retake: null }, homework: { d: 2, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 4주차', shortLabel: '4주차', date: '2026-07-19', att: 'present', reading: null, vocab: { c: 45, t: 50, classAvg: 87, retake: null }, homework: { d: 4.5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 5주차', shortLabel: '5주차', date: '2026-07-26', att: 'present', reading: null, vocab: { c: 43, t: 50, classAvg: 84, retake: null }, homework: { d: 4, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 8주차', shortLabel: '8주차', date: '2026-08-16', att: 'present', reading: null, vocab: { c: 32, t: 40, classAvg: 75, retake: null }, homework: { d: 4.5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 9주차', shortLabel: '9주차', date: '2026-08-23', att: 'present', reading: null, vocab: { c: 45, t: 50, classAvg: 89, retake: null }, homework: { d: 4, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '시즌3', label: '시즌3 10주차', shortLabel: '10주차', date: '2026-08-30', att: 'present', reading: null, vocab: { c: 43, t: 50, classAvg: 90, retake: null }, homework: { d: 4, t: 5 }, comment: null, wrongQ: [],
        wrongW: [
          { word: 'distract', ko: '집중하게 하다', mine: '집중하다', source: 'antonym', original: 'focus', syn: [], ant: ['focus'] },
          { word: 'audition', ko: '청각', mine: '오디션', source: 'derivative', original: 'auditory', syn: [], ant: [] },
          { word: 'appeal', ko: '호소', mine: null, source: 'synonym', original: 'plea', syn: ['plea'], ant: [] },
          { word: 'compel', ko: '강요하다', mine: '완성하다', source: 'meaning', syn: ['force'], ant: [] },
          { word: 'deliberate', ko: '의도적인', mine: null, source: 'meaning', syn: ['intentional'], ant: ['accidental'] },
          { word: 'subtle', ko: '미묘한', mine: '자막', source: 'meaning', syn: ['delicate'], ant: ['obvious'] },
          { word: 'yield', ko: '산출하다, 굴복하다', mine: '노란', source: 'meaning', syn: ['produce'], ant: [] },
        ] },
    ],
    attendance: {
      regular: { present: 24, total: 24, streak: 24 }, clinic: { present: 7, total: 8 },
      clinicDays: { '2026-08-05': 'present', '2026-08-12': 'absent', '2026-08-19': 'present', '2026-08-26': 'present' },
    },
    analysis: {
      types: null,
      patterns: [{ name: '순서', state: 'deteriorating', weeks: [50, 33, 0, 0], insight: '최근 정답률 0% · 갈수록 낮아지고 있어요' }],
    },
  },

  '김대영 (고1 · 새 기간 1주)': {
    student: { name: '김대영', headerLine: '1학년 · 숭문고 · 숭문고 고1반' },
    periods: [{ label: '2학기 중간', isCurrent: true, start: '2026-08-20', end: null }, { label: '여름방학', start: '2026-07-20', end: '2026-08-19' }, { label: '1학기 기말', start: '2026-05-25', end: '2026-07-19' }],
    weeks: [
      { period: '여름방학', label: '여름방학 3주차', shortLabel: '3주차', date: '2026-08-06', att: 'present', reading: { c: 2, t: 10, classAvg: 25 }, vocab: { c: 46, t: 49, classAvg: 81, retake: null }, homework: { d: 5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '여름방학', label: '여름방학 4주차', shortLabel: '4주차', date: '2026-08-13', att: 'present', reading: { c: 3, t: 10, classAvg: 43 }, vocab: { c: 21, t: 50, classAvg: 46, retake: null }, homework: { d: 3.5, t: 5 }, comment: null, wrongQ: [], wrongW: [] },
      { period: '2학기 중간', label: '2학기 중간 2주차', shortLabel: '2주차', date: '2026-08-27', att: 'present', reading: { c: 17, t: 17, classAvg: 87 }, vocab: { c: 34, t: 50, classAvg: 77, retake: null }, homework: { d: 2.5, t: 5 }, comment: null, wrongQ: [],
        wrongW: [
          { word: 'identical', ko: '동일한', mine: '상징적인', source: 'antonym', original: 'various', syn: ['same'], ant: ['various'] },
          { word: 'trivial', ko: '사소한', mine: null, source: 'antonym', original: 'valuable', syn: ['minor'], ant: ['valuable'] },
          { word: 'take apart', ko: '분해하다', mine: '거리를 두다', source: 'antonym', original: 'assemble', syn: [], ant: ['assemble'] },
          { word: 'reject', ko: '거절하다', mine: '보고서', source: 'antonym', original: 'accept', syn: ['refuse'], ant: ['accept'] },
          { word: 'impress', ko: '감명을 주다', mine: '인상을 받다', source: 'derivative', original: 'impressive', syn: [], ant: [] },
          { word: 'adversity', ko: '역경', mine: null, source: 'synonym', original: 'hardship', syn: ['hardship'], ant: [] },
          { word: 'reluctant', ko: '꺼리는', mine: '관련된', source: 'meaning', syn: ['unwilling'], ant: ['eager'] },
          { word: 'inevitable', ko: '피할 수 없는', mine: null, source: 'meaning', syn: ['unavoidable'], ant: [] },
          { word: 'diminish', ko: '줄어들다', mine: '차원', source: 'meaning', syn: ['decrease'], ant: ['increase'] },
          { word: 'notion', ko: '개념, 관념', mine: '공지', source: 'meaning', syn: ['idea'], ant: [] },
          { word: 'plausible', ko: '그럴듯한', mine: null, source: 'meaning', syn: ['believable'], ant: [] },
          { word: 'undergo', ko: '겪다', mine: '아래로 가다', source: 'meaning', syn: ['experience'], ant: [] },
          { word: 'temper', ko: '성질, 기분', mine: '온도', source: 'meaning', syn: ['mood'], ant: [] },
          { word: 'grave', ko: '심각한', mine: '무덤', source: 'meaning', syn: ['serious'], ant: [] },
          { word: 'stern', ko: '엄격한', mine: null, source: 'meaning', syn: ['strict'], ant: ['lenient'] },
          { word: 'vain', ko: '헛된', mine: '정맥', source: 'meaning', syn: ['futile'], ant: [] },
        ] },
    ],
    attendance: {
      regular: { present: 18, total: 20, streak: 3 }, clinic: { present: 11, total: 13 },
      clinicDays: { '2026-08-04': 'present', '2026-08-11': 'present', '2026-08-18': 'absent', '2026-08-25': 'present' },
    },
    analysis: { types: null, patterns: [] },
  },
};
