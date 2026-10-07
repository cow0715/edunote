import type { ConceptTag, ShareData, StudentAnswer, VocabWord, Week } from '@/app/share/[token]/share-types'

// 개발자 도구에서 실제 share 컴포넌트와 복습 흐름을 확인하는 전용 기록이다.
// 학생·반·문항은 모두 이 파일에서 작성한 가상 데이터이며 API/DB를 조회하지 않는다.
export const SAMPLE_PERIODS = [
  { id: 'semester', label: '2학기 누적', startDate: '2026-08-07', endDate: '2026-10-31', weekCount: 12 },
  { id: 'september', label: '9월 학습', startDate: '2026-09-01', endDate: '2026-09-30', weekCount: 4 },
  { id: 'october', label: '10월 학습', startDate: '2026-10-01', endDate: '2026-10-31', weekCount: 2 },
] as const

export const SAMPLE_SCENARIOS = [
  { id: 'default', label: '기본 분석', description: '반복되는 오답과 안정적인 유형이 함께 있는 기록' },
  { id: 'short', label: '기록 부족', description: '최근 2회만 기록되어 약점 판단을 보류하는 상황' },
  { id: 'decline', label: '최근 오답 증가', description: '누적 성적은 좋지만 최근 빈칸 문항에서 오답이 늘어난 기록' },
  { id: 'recovery', label: '최근 회복', description: '이전에는 틀렸던 빈칸 문항을 최근에는 모두 맞힌 기록' },
  { id: 'perfect', label: '모두 정답', description: '선택 기간의 독해와 단어를 모두 맞힌 기록' },
] as const

export type ShareDesignPeriodId = typeof SAMPLE_PERIODS[number]['id']
export type ShareDesignScenarioId = typeof SAMPLE_SCENARIOS[number]['id']
export const SHARE_DESIGN_DEFAULT_PERIOD_ID: ShareDesignPeriodId = 'semester'
export const SHARE_DESIGN_DEFAULT_SCENARIO_ID: ShareDesignScenarioId = 'default'

const CLASS_ID = 'share-design-class'
const CLASS_NAME = '고2 영어 심화반'
const DATES = ['2026-08-07', '2026-08-11', '2026-08-14', '2026-08-18', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-06']

type ReadingSample = {
  stem: string
  passage: string
  choices: [string, string, string, string, string]
  answer: number
  explanation: string
}
type ReadingType = { tag: ConceptTag; questions: ReadingSample[] }
const tag = (id: string, name: string): ConceptTag => ({ id: `share-design-${id}`, name, category_id: 'reading', category_name: '독해 유형' })

// 선지와 해설까지 제공하여 오답 열기 → 다시 풀기 → 정답 확인을 실제 화면처럼 사용할 수 있다.
const READING_TYPES: ReadingType[] = [
  {
    tag: tag('blank', '빈칸'),
    questions: [
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'When people learn a new skill, they often expect every attempt to be better than the last. Yet progress rarely follows a straight line. A musician may practice the same passage for days without hearing a difference. During that time, the brain is still building useful connections. A quiet period is therefore not always a sign of failure; it may be a period of ________.',
        choices: ['preparation for later progress', 'avoidance of difficult decisions', 'competition with other learners', 'dependence on natural talent', 'repetition without any purpose'], answer: 1,
        explanation: '겉으로 발전이 보이지 않는 동안에도 뇌가 연결을 형성하고 있다는 내용입니다. 빈칸은 앞의 quiet period를 다시 설명하므로, 나중의 발전을 준비하는 기간이라는 ①이 가장 자연스럽습니다.',
      },
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'A city garden does more than provide vegetables. Neighbors who rarely spoke to one another begin exchanging tools and advice. Children learn where food comes from, and older residents share practical knowledge. The harvest is valuable, but the lasting benefit is often the ________ that grows alongside it.',
        choices: ['amount of money saved', 'competition for limited space', 'relationship among residents', 'speed of modern transportation', 'demand for imported food'], answer: 3,
        explanation: '도구와 조언을 나누고 세대 간 지식을 공유하는 사례들이 반복됩니다. 수확물과 함께 자라는 것은 주민 간의 관계이므로 ③이 맞습니다.',
      },
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'A useful map leaves out many details. If it showed every tree, window, and stone, it would become as difficult to understand as the place itself. By selecting only the information a traveler needs, a map shows that accuracy sometimes depends on ________.',
        choices: ['collecting every available detail', 'using the largest possible scale', 'following another traveler', 'making thoughtful choices about what to include', 'replacing observation with imagination'], answer: 4,
        explanation: '모든 정보를 담는 대신 여행자에게 필요한 정보를 선택한다는 글입니다. 정확성이 정보의 적절한 선택에 달려 있다는 ④가 핵심을 연결합니다.',
      },
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'Remembering a fact is easier when it is connected to something we already know. A date on its own may quickly disappear from memory, but the same date can become meaningful when it belongs to a story. This is why learning becomes more effective when new information is ________.',
        choices: ['presented without any context', 'kept separate from previous experience', 'linked to existing knowledge', 'repeated as quickly as possible', 'limited to numbers and dates'], answer: 3,
        explanation: '이미 아는 내용과 연결하면 기억하기 쉬워진다는 주장이 이야기 속 날짜의 예로 이어집니다. 새 정보를 기존 지식과 연결한다는 ③이 맞습니다.',
      },
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'A team can benefit from members who notice different things. One person may focus on details while another sees the larger pattern. When both views are considered, mistakes become easier to find. Agreement is useful, but good decisions can also grow from ________.',
        choices: ['avoiding all discussion', 'different ways of looking at a problem', 'giving every task to one person', 'finishing work before making a plan', 'accepting the first available idea'], answer: 2,
        explanation: '세부와 전체를 보는 서로 다른 관점을 함께 고려하는 장점을 설명합니다. 모두의 일치만이 아니라 다양한 관점에서도 좋은 결정이 나온다는 ②입니다.',
      },
      {
        stem: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
        passage: 'When we hear a familiar opinion, we may accept it without checking the facts. A claim can seem true simply because many people repeat it. Careful readers therefore ask where the information came from and whether the evidence supports it. They understand that repetition is not the same as ________.',
        choices: ['a popular conversation', 'a source of entertainment', 'a memorable expression', 'a reason to believe a claim', 'a way to share an experience'], answer: 4,
        explanation: '의견이 반복된다는 사실만으로는 사실 여부가 입증되지 않습니다. 출처와 증거를 확인해야 한다는 앞부분과 연결되는 ④가 정답입니다.',
      },
    ],
  },
  {
    tag: tag('order', '순서'),
    questions: [
      {
        stem: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
        passage: 'A school decided to reduce the amount of paper used in its classrooms.\n\n(A) After a month, teachers compared the results. Paper use had fallen, but students still wanted printed copies of long texts.\n\n(B) The school then kept digital handouts for short activities and printed materials for longer reading. This balanced plan worked better.\n\n(C) At first, it replaced every worksheet with a digital file. Students received links instead of printed pages.',
        choices: ['(A) — (C) — (B)', '(B) — (A) — (C)', '(B) — (C) — (A)', '(C) — (A) — (B)', '(C) — (B) — (A)'], answer: 4,
        explanation: '첫 시도를 설명하는 At first의 (C), 한 달 후 결과를 확인하는 (A), 그 결과를 바탕으로 계획을 수정하는 then의 (B) 순서입니다.',
      },
      {
        stem: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
        passage: 'Scientists wanted to find out whether trees could affect the temperature of a street.\n\n(A) They placed thermometers on two similar streets, one with trees and one without them.\n\n(B) These results suggested that planting trees could help make summer walks more comfortable.\n\n(C) On hot afternoons, the shaded street was several degrees cooler. The difference was smaller at night.',
        choices: ['(A) — (B) — (C)', '(A) — (C) — (B)', '(B) — (A) — (C)', '(C) — (A) — (B)', '(C) — (B) — (A)'], answer: 2,
        explanation: '실험 방법인 (A) 뒤에 관측 결과인 (C)가 옵니다. (B)의 These results가 바로 그 결과를 받아 결론을 내리므로 (A)–(C)–(B)입니다.',
      },
      {
        stem: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
        passage: 'A small library noticed that many of its books were never borrowed.\n\n(A) To solve this problem, the staff moved those books to a table near the entrance and added short recommendation cards.\n\n(B) After this change, more visitors picked them up. The books had not changed, but their visibility had.\n\n(C) A survey revealed that visitors simply did not know these books were available on the back shelves.',
        choices: ['(A) — (B) — (C)', '(A) — (C) — (B)', '(B) — (C) — (A)', '(C) — (A) — (B)', '(C) — (B) — (A)'], answer: 4,
        explanation: '문제의 원인을 확인하는 (C), This problem을 해결하는 (A), This change 이후의 결과를 설명하는 (B) 순으로 연결됩니다.',
      },
    ],
  },
  {
    tag: tag('insert', '삽입'),
    questions: [
      {
        stem: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\nHowever, silence does not necessarily mean that no learning is taking place.',
        passage: 'Teachers sometimes measure participation by how often students speak. (①) A student who quickly raises a hand is easy to notice. (②) Another student may remain quiet while carefully comparing several possible answers. (③) That student may be forming a clear explanation before saying anything aloud. (④) Providing time to think can therefore help more students join a discussion. (⑤)',
        choices: ['①', '②', '③', '④', '⑤'], answer: 3,
        explanation: '조용히 여러 답을 비교하는 학생을 소개한 뒤, 침묵이 학습의 부재는 아니라는 전환이 필요합니다. 이어지는 That student는 그 학생의 사고 과정을 설명하므로 ③입니다.',
      },
      {
        stem: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\nThis stored water becomes especially useful during dry weather.',
        passage: 'Some plants have thick leaves that hold water. (①) After rain, the leaves absorb more water than the plant immediately needs. (②) When little rain falls, the plant slowly uses its reserves. (③) As a result, it can continue growing in conditions that would harm many other plants. (④) These leaves are one example of how living things adapt to their environment. (⑤)',
        choices: ['①', '②', '③', '④', '⑤'], answer: 2,
        explanation: 'This stored water는 비가 온 뒤 잎이 흡수한 물을 가리킵니다. 건조한 날에 유용하다는 주어진 문장 뒤에 물 저장분의 사용을 설명하는 문장이 이어져야 하므로 ②입니다.',
      },
      {
        stem: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\nThe next step is to test whether that explanation fits other examples.',
        passage: 'Curiosity often begins with a surprising observation. (①) We see something that does not match what we expected. (②) We then try to explain why it happened. (③) If the same explanation works repeatedly, we become more confident in it. (④) If it fails, we revise it and ask another question. (⑤)',
        choices: ['①', '②', '③', '④', '⑤'], answer: 3,
        explanation: 'that explanation은 바로 앞의 설명 시도를 받습니다. 검증 단계 뒤에 반복적으로 잘 맞는 경우와 실패하는 경우가 나뉘어 나오므로 ③에 들어갑니다.',
      },
    ],
  },
  {
    tag: tag('grammar', '어법'),
    questions: [
      {
        stem: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
        passage: 'Students ①who keep a reading journal often notice ideas they would otherwise forget. A journal ②allows them to return to earlier questions. The notes ③written after each chapter can also reveal how their understanding changes. What matters most ④are the habit of thinking carefully, rather than the number of pages filled. This habit makes reading ⑤more meaningful.',
        choices: ['who', 'allows', 'written', 'are', 'more meaningful'], answer: 4,
        explanation: 'What matters most는 하나의 명사절 주어이므로 단수 동사 is가 필요합니다. 뒤의 the habit도 단수입니다. ③ written은 notes를 수식하는 과거분사로 맞습니다.',
      },
      {
        stem: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
        passage: 'The museum has a room ①where visitors can touch copies of ancient tools. The guide encourages children ②to ask questions. Each of the objects ③have a label explaining its purpose. Many visitors find it ④easier to remember an object after holding it. The experience helps them imagine how people ⑤lived in the past.',
        choices: ['where', 'to ask', 'have', 'easier', 'lived'], answer: 3,
        explanation: 'Each of + 복수명사가 주어일 때 동사는 Each에 맞춰 단수로 써야 합니다. have를 has로 고칩니다.',
      },
      {
        stem: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
        passage: 'People often remember a story better when they can connect it to something ①familiar. A teacher may ask students ②whether an event reminds them of their own lives. Such questions make the story ③feel closer. They also provide opportunities for students ④sharing different experiences. Listening to these experiences ⑤broadens the class discussion.',
        choices: ['familiar', 'whether', 'feel', 'sharing', 'broadens'], answer: 4,
        explanation: 'opportunities 뒤에서 기회를 구체화하는 표현은 for students to share입니다. students는 부정사의 의미상 주어이고 sharing을 to share로 고쳐야 합니다.',
      },
    ],
  },
  {
    tag: tag('vocabulary', '어휘'),
    questions: [
      {
        stem: '다음 글의 밑줄 친 낱말 중, 문맥상 쓰임이 적절하지 않은 것은?',
        passage: 'A good listener does not rush to give advice. Instead, the listener ①allows the speaker to finish and asks questions to ②clarify unclear points. This can make the speaker feel ③understood. Advice offered too early may ④strengthen the conversation by preventing the speaker from expressing the real problem. Patience is therefore an ⑤important part of listening.',
        choices: ['allows', 'clarify', 'understood', 'strengthen', 'important'], answer: 4,
        explanation: '너무 이른 조언은 실제 문제의 표현을 막는다는 부정적인 결과가 이어집니다. strengthen이 아니라 weaken 또는 interrupt가 문맥에 맞습니다.',
      },
      {
        stem: '다음 글의 밑줄 친 낱말 중, 문맥상 쓰임이 적절하지 않은 것은?',
        passage: 'Wild animals need routes between feeding and resting places. Roads can ①divide these areas and make movement dangerous. A wildlife bridge offers a ②safe path over traffic. Plants on the bridge make it look more ③natural. Such crossings can ④increase collisions by keeping animals away from moving vehicles. Protecting these routes supports animal ⑤survival.',
        choices: ['divide', 'safe', 'natural', 'increase', 'survival'], answer: 4,
        explanation: '동물을 차량에서 떨어뜨려 충돌을 줄인다는 내용입니다. increase는 반대 뜻이므로 reduce로 바꾸어야 합니다.',
      },
      {
        stem: '다음 글의 밑줄 친 낱말 중, 문맥상 쓰임이 적절하지 않은 것은?',
        passage: 'Feedback works best when it is ①specific. Telling a writer which sentence is unclear gives the writer a ②useful place to begin. General criticism can leave the writer ③uncertain about what to change. A clear explanation makes revision more ④difficult because it identifies a concrete next step. Good feedback should ⑤support improvement.',
        choices: ['specific', 'useful', 'uncertain', 'difficult', 'support'], answer: 4,
        explanation: '구체적인 다음 단계를 제시하면 수정은 더 쉬워집니다. difficult를 easier 또는 manageable로 바꿔야 흐름에 맞습니다.',
      },
    ],
  },
  {
    tag: tag('claim', '주장'),
    questions: [
      {
        stem: '다음 글에서 필자가 주장하는 바로 가장 적절한 것은?',
        passage: 'When we give students group projects, we should not assume that teamwork will happen automatically. Students need practice dividing tasks, listening to different views, and checking progress together. These skills deserve explicit instruction. A successful project is not simply a finished poster; it is also a chance to learn how to work with others.',
        choices: ['모둠 과제는 개인 과제보다 항상 효과적이다.', '협력에 필요한 기술을 구체적으로 가르쳐야 한다.', '학생에게 가능한 한 많은 과제를 주어야 한다.', '모둠의 결과물은 학생의 성적을 결정해야 한다.', '협력을 위해 학생 간 의견 차이를 없애야 한다.'], answer: 2,
        explanation: '역할 분담, 경청, 진행 상황 확인 같은 기술을 명시적으로 가르칠 필요가 있다는 문장이 주장입니다. 결과물만 강조하지 않는다는 점도 ②를 뒷받침합니다.',
      },
      {
        stem: '다음 글에서 필자가 주장하는 바로 가장 적절한 것은?',
        passage: 'Before replacing a broken object, try to understand why it stopped working. A loose connection or a damaged button may be easy to repair. Learning a small repair can save resources and build confidence. Communities should offer more chances for people to learn these basic skills rather than treating every broken object as waste.',
        choices: ['고장 난 물건을 모두 보관해야 한다.', '새 제품은 더 오래 사용할 수 있게 만들어야 한다.', '수리하는 데 드는 비용을 높여야 한다.', '기초적인 수리 기술을 배울 기회를 늘려야 한다.', '물건의 디자인보다 기능을 우선해야 한다.'], answer: 4,
        explanation: '마지막 문장의 should offer more chances가 핵심 주장입니다. 자원 절약과 자신감은 수리 기술을 배워야 하는 이유입니다.',
      },
      {
        stem: '다음 글에서 필자가 주장하는 바로 가장 적절한 것은?',
        passage: 'A schedule is useful, but it should include space for the unexpected. If every minute is filled, a small delay can ruin the entire plan. Leaving a little extra time makes it easier to respond calmly. Plan your day with flexibility instead of trying to control every moment.',
        choices: ['계획에는 예상하지 못한 상황을 위한 여유를 두어야 한다.', '중요한 일은 항상 아침에 끝내야 한다.', '일정은 다른 사람과 함께 정해야 한다.', '시간을 아끼려면 여러 일을 동시에 해야 한다.', '일상생활에서는 자세한 계획을 세우지 말아야 한다.'], answer: 1,
        explanation: '필자는 계획을 없애자는 것이 아니라 유연성을 포함하라고 제안합니다. 예상치 못한 상황에 대응할 여유를 두라는 ①이 맞습니다.',
      },
    ],
  },
  {
    tag: tag('title', '제목'),
    questions: [
      {
        stem: '다음 글의 제목으로 가장 적절한 것은?',
        passage: 'The first version of an idea often looks incomplete. Inventors test rough models, writers change early drafts, and cooks adjust recipes. These imperfect attempts reveal problems that cannot be discovered by thinking alone. Making something before it is perfect can be the most useful step toward making it better.',
        choices: ['Why Every First Attempt Must Succeed', 'The Hidden Cost of Creative Work', 'Learning from an Imperfect Beginning', 'How to Avoid Changing Your Plans', 'Talent: The Only Source of Original Ideas'], answer: 3,
        explanation: '불완전한 첫 시도가 개선을 위한 정보를 제공한다는 것이 공통 주제입니다. ③이 발명, 글쓰기, 요리의 사례를 모두 포괄합니다.',
      },
      {
        stem: '다음 글의 제목으로 가장 적절한 것은?',
        passage: 'Urban trees offer shade, reduce noise, and provide places for birds to rest. Their benefits are not limited to parks. Even a few trees along a busy street can make walking more pleasant. Planning a city therefore requires attention to living things as well as roads and buildings.',
        choices: ['The Fastest Way to Build a New City', 'Trees: Quiet Partners in City Life', 'Why Birds Prefer Tall Buildings', 'The History of Public Transportation', 'Parks as a Replacement for Streets'], answer: 2,
        explanation: '도시 생활에 기여하는 나무의 여러 역할을 다룹니다. 특정한 장점 하나로 한정하지 않는 ②가 가장 적절합니다.',
      },
      {
        stem: '다음 글의 제목으로 가장 적절한 것은?',
        passage: 'A difficult question can become easier when we explain it to someone else. To make our explanation clear, we must organize what we know and notice what is missing. The listener does not always need to offer an answer. Sometimes the act of explaining creates the understanding we were looking for.',
        choices: ['The Listener Must Always Know the Answer', 'Why Simple Questions Are More Important', 'Speaking Quickly to Save Time', 'Understanding Through Explanation', 'Learning Without Communicating'], answer: 4,
        explanation: '설명을 만드는 과정에서 지식이 정리되고 이해가 생긴다는 내용입니다. ④가 글의 핵심을 담습니다.',
      },
    ],
  },
  {
    tag: tag('detail', '내용 일치'),
    questions: [
      {
        stem: '다음 안내문의 내용과 일치하는 것은?',
        passage: 'Community Reading Walk\nSaturday, October 10, 10:00 a.m.–12:00 p.m.\nMeet outside the public library. Participants will walk to three neighborhood locations and read a short story at each stop. The activity is free, but registration is required by October 8. Bring comfortable shoes and a bottle of water. Children under twelve should attend with an adult. The walk will be canceled if heavy rain is expected.',
        choices: ['오후 1시에 도서관 안에서 시작한다.', '참가비는 장소마다 별도로 낸다.', '사전 신청 없이 누구나 참여할 수 있다.', '모든 어린이는 혼자 참여해야 한다.', '폭우가 예상되면 행사가 취소된다.'], answer: 5,
        explanation: '마지막 문장의 heavy rain is expected 조건에서 행사를 취소한다는 설명과 ⑤가 일치합니다. 무료 행사이지만 사전 신청은 필요합니다.',
      },
      {
        stem: '다음 글의 내용과 일치하는 것은?',
        passage: 'Mira began keeping a nature diary when she was ten. She first recorded the birds near her home, using drawings instead of photographs. In high school, she joined a local conservation group. She later studied biology and returned to her hometown to teach. She still uses her childhood diary in class to show students that careful observation can begin with simple tools.',
        choices: ['열 살 때부터 자연 관찰 일기를 쓰기 시작했다.', '처음부터 새를 사진으로만 기록했다.', '대학에 들어간 뒤 처음 환경 단체에 가입했다.', '생물학 대신 미술을 전공했다.', '어린 시절의 일기를 수업에 사용하지 않는다.'], answer: 1,
        explanation: '첫 문장의 when she was ten과 ①이 일치합니다. 나머지는 그림 기록, 고등학교 단체 가입, 생물학 전공, 일기의 수업 활용과 어긋납니다.',
      },
      {
        stem: '다음 안내문의 내용과 일치하는 것은?',
        passage: 'School Repair Workshop\nEvery Wednesday in September, 4:00–5:30 p.m.\nStudents can learn to repair simple household items in the science room. Materials and tools are provided. The workshop accepts up to fifteen students each week. Participants must sign up by Monday and bring one small item to repair. Electrical appliances are not accepted. A teacher will supervise every session.',
        choices: ['9월에 매주 월요일 열린다.', '공구는 참가자가 모두 준비해야 한다.', '매주 최대 15명의 학생이 참여한다.', '전기 제품만 수리할 수 있다.', '교사의 지도 없이 진행된다.'], answer: 3,
        explanation: 'The workshop accepts up to fifteen students each week가 ③의 근거입니다. 신청은 월요일까지지만 실제 수업은 수요일입니다.',
      },
    ],
  },
]

type WordSample = { english: string; meaning: string; pos: string; sentence: string; translation: string; synonym: string; antonym?: string; wrong: string }
const WORDS: WordSample[] = [
  { english: 'observe', meaning: '관찰하다', pos: '동사', sentence: 'Scientists observe how plants respond to light.', translation: '과학자들은 식물이 빛에 어떻게 반응하는지 관찰한다.', synonym: 'notice', wrong: '보존하다' },
  { english: 'maintain', meaning: '유지하다', pos: '동사', sentence: 'Regular practice helps maintain a useful habit.', translation: '규칙적인 연습은 유용한 습관을 유지하는 데 도움이 된다.', synonym: 'preserve', wrong: '개선하다' },
  { english: 'evidence', meaning: '증거', pos: '명사', sentence: 'We need more evidence before drawing a conclusion.', translation: '결론을 내리기 전에 더 많은 증거가 필요하다.', synonym: 'proof', wrong: '의견' },
  { english: 'contrast', meaning: '대조', pos: '명사', sentence: 'The contrast between the two results was clear.', translation: '두 결과 사이의 대조는 분명했다.', synonym: 'difference', antonym: 'similarity', wrong: '비교하다' },
  { english: 'adapt', meaning: '적응하다', pos: '동사', sentence: 'Animals adapt to changes in their environment.', translation: '동물은 환경의 변화에 적응한다.', synonym: 'adjust', wrong: '입양하다' },
  { english: 'significant', meaning: '중요한', pos: '형용사', sentence: 'Even a small change can have a significant effect.', translation: '작은 변화도 중요한 영향을 미칠 수 있다.', synonym: 'important', antonym: 'minor', wrong: '비슷한' },
  { english: 'consequence', meaning: '결과', pos: '명사', sentence: 'Consider the consequence of each decision.', translation: '각 결정의 결과를 고려하라.', synonym: 'result', wrong: '원인' },
  { english: 'require', meaning: '필요로 하다', pos: '동사', sentence: 'Working together requires patience.', translation: '함께 일하는 데에는 인내가 필요하다.', synonym: 'need', wrong: '요청하다' },
  { english: 'perspective', meaning: '관점', pos: '명사', sentence: 'A new perspective can help us solve a problem.', translation: '새로운 관점은 문제를 해결하는 데 도움이 될 수 있다.', synonym: 'viewpoint', wrong: '전망' },
  { english: 'efficient', meaning: '효율적인', pos: '형용사', sentence: 'The new system is more efficient than the old one.', translation: '새 시스템은 이전 시스템보다 더 효율적이다.', synonym: 'effective', antonym: 'inefficient', wrong: '충분한' },
  { english: 'respond', meaning: '반응하다', pos: '동사', sentence: 'People respond differently to the same situation.', translation: '사람들은 같은 상황에 다르게 반응한다.', synonym: 'react', wrong: '대표하다' },
  { english: 'benefit', meaning: '이익', pos: '명사', sentence: 'The project brought a benefit to the whole community.', translation: '그 사업은 지역 사회 전체에 이익을 가져왔다.', synonym: 'advantage', antonym: 'disadvantage', wrong: '기부하다' },
  { english: 'clarify', meaning: '명확하게 하다', pos: '동사', sentence: 'Please clarify what you mean by that statement.', translation: '그 진술이 무엇을 의미하는지 명확하게 해 주세요.', synonym: 'explain', wrong: '분류하다' },
  { english: 'resource', meaning: '자원', pos: '명사', sentence: 'Clean water is an important natural resource.', translation: '깨끗한 물은 중요한 천연자원이다.', synonym: 'supply', wrong: '연구' },
  { english: 'flexible', meaning: '유연한', pos: '형용사', sentence: 'A flexible plan allows room for unexpected events.', translation: '유연한 계획에는 예상치 못한 일을 위한 여유가 있다.', synonym: 'adaptable', antonym: 'rigid', wrong: '복잡한' },
  { english: 'preserve', meaning: '보존하다', pos: '동사', sentence: 'We should preserve places where wild animals live.', translation: '우리는 야생 동물이 사는 장소를 보존해야 한다.', synonym: 'protect', antonym: 'destroy', wrong: '예약하다' },
  { english: 'reveal', meaning: '드러내다', pos: '동사', sentence: 'The experiment may reveal a new pattern.', translation: '그 실험은 새로운 양상을 드러낼 수 있다.', synonym: 'show', antonym: 'conceal', wrong: '반복하다' },
  { english: 'available', meaning: '이용 가능한', pos: '형용사', sentence: 'The books are available at the public library.', translation: '그 책들은 공공 도서관에서 이용할 수 있다.', synonym: 'accessible', antonym: 'unavailable', wrong: '가치 있는' },
  { english: 'confidence', meaning: '자신감', pos: '명사', sentence: 'Small successes can build confidence.', translation: '작은 성공들이 자신감을 키울 수 있다.', synonym: 'assurance', antonym: 'doubt', wrong: '기밀' },
  { english: 'concrete', meaning: '구체적인', pos: '형용사', sentence: 'Good feedback gives a concrete next step.', translation: '좋은 피드백은 구체적인 다음 단계를 제시한다.', synonym: 'specific', antonym: 'abstract', wrong: '정확한' },
  { english: 'support', meaning: '지원하다', pos: '동사', sentence: 'The teacher supports students as they try new ideas.', translation: '선생님은 학생들이 새로운 생각을 시도할 때 지원한다.', synonym: 'help', antonym: 'oppose', wrong: '예상하다' },
  { english: 'reserve', meaning: '비축분', pos: '명사', sentence: 'The plant uses its water reserves during dry weather.', translation: '그 식물은 건조한 날씨에 저장된 물을 사용한다.', synonym: 'stock', wrong: '예약' },
  { english: 'revise', meaning: '수정하다', pos: '동사', sentence: 'Writers revise their drafts after receiving feedback.', translation: '작가는 피드백을 받은 후 초안을 수정한다.', synonym: 'edit', wrong: '회복하다' },
  { english: 'survival', meaning: '생존', pos: '명사', sentence: 'A safe habitat is essential for animal survival.', translation: '안전한 서식지는 동물의 생존에 필수적이다.', synonym: 'existence', wrong: '발전' },
]

function readingResults(typeIndex: number, globalWeek: number, scenario: ShareDesignScenarioId): { total: number; correct: number } {
  if (scenario === 'perfect') return { total: 3, correct: 3 }
  if (typeIndex === 0 && scenario === 'decline') {
    // 12회 누적 52/60(87%), 최근 4회 4/12(33%): 누적 안정 + 최근 확인 사례.
    return globalWeek < 8 ? { total: 6, correct: 6 } : { total: 3, correct: 1 }
  }
  if (typeIndex === 0 && scenario === 'recovery') {
    // 12회 누적 24/48(50%), 최근 4회 16/16(100%): 현재 적극 추천에서 제외.
    return { total: 4, correct: globalWeek < 8 ? 1 : 4 }
  }
  const patterns = [[1, 1, 2, 1], [1, 2, 1, 2], [2, 2, 3, 2], [2, 3, 2, 2], [3, 3, 2, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 2, 3, 3]]
  return { total: 3, correct: patterns[typeIndex][globalWeek % 4] }
}

function teacherMemo(globalWeek: number, scenario: ShareDesignScenarioId) {
  if (scenario === 'perfect') return '이번 수업은 독해와 단어를 모두 정확히 풀었습니다. 지문에서 근거를 찾는 습관을 유지하고, 다음 수업에서는 조금 더 긴 글로 연습하겠습니다.'
  if (scenario === 'short') return '첫 기록이 잘 쌓이고 있습니다. 아직 유형별 출제 횟수가 적으니 점수만으로 약점을 단정하기보다, 틀린 문제에서 근거 문장을 찾아보면 좋겠습니다.'
  if (scenario === 'decline' && globalWeek >= 8) return '최근 빈칸 문항에서 앞뒤 논리를 연결하는 부분을 다시 확인하고 있습니다. 빈칸 앞의 주장과 뒤의 예시를 구분한 뒤 선지를 고르는 연습을 해 주세요.'
  if (scenario === 'recovery' && globalWeek >= 8) return '빈칸 문항에서 글의 핵심을 먼저 정리하는 습관이 좋아졌습니다. 최근에는 근거를 정확히 찾았습니다. 이전 오답을 한 번 더 설명해 보고 이 흐름을 유지해 주세요.'
  const memos = [
    '주장과 제목 문항은 근거를 안정적으로 찾고 있습니다. 순서 문항은 연결어뿐 아니라 지시어가 가리키는 내용도 함께 표시하며 복습해 주세요.',
    '긴 지문에서도 끝까지 읽는 집중력이 좋았습니다. 빈칸은 선지를 먼저 보기보다 글의 중심 문장을 한 줄로 정리한 뒤 풀어 보겠습니다.',
    '단어 재시험에서 지난 오답을 많이 보완했습니다. 어법은 주어와 동사를 표시하고, 왜 다른 선지는 맞는지도 설명해 보세요.',
    '내용 일치 문항은 세부 정보를 정확히 확인했습니다. 이번 오답은 빈칸과 글의 순서에 모여 있어, 수업에서 표시한 근거를 중심으로 복습하면 좋겠습니다.',
  ]
  return memos[globalWeek % memos.length]
}

/** 같은 학생의 선택 기간 기록을 반환한다. 모르는 id는 기본 값으로 복구한다. */
export function getShareDesignSample(periodId: string = SHARE_DESIGN_DEFAULT_PERIOD_ID, scenarioId: string = SHARE_DESIGN_DEFAULT_SCENARIO_ID): ShareData {
  const period = SAMPLE_PERIODS.find((option) => option.id === periodId) ?? SAMPLE_PERIODS[0]
  const scenario = SAMPLE_SCENARIOS.find((option) => option.id === scenarioId)?.id ?? SHARE_DESIGN_DEFAULT_SCENARIO_ID
  const matchingDates = DATES.map((date, globalWeek) => ({ date, globalWeek })).filter(({ date }) => date >= period.startDate && date <= period.endDate)
  const selectedDates = scenario === 'short' ? matchingDates.slice(-2) : matchingDates
  const data: ShareData = {
    student: { id: 'share-design-student', name: '김민준', school: '가상고등학교', grade: '고2' },
    classes: [{ id: CLASS_ID, name: CLASS_NAME, academic_year: 2026, school_name: '가상고등학교', grade_level: 2 }],
    currentPeriod: { id: period.id, class_id: CLASS_ID, label: period.label, start_date: period.startDate, end_date: period.endDate, is_current: period.id === 'october' },
    periodOptions: SAMPLE_PERIODS.map((option) => ({ id: option.id, class_id: CLASS_ID, class_name: CLASS_NAME, class_type: 'regular', label: option.label, start_date: option.startDate, end_date: option.endDate, is_current: option.id === 'october', is_active_class: true, week_count: scenario === 'short' ? Math.min(2, option.weekCount) : option.weekCount })),
    weeks: [], weekScores: [], studentAnswers: [], vocabAnswers: [], vocabWords: [], attendance: [], clinicAttendance: [], classAverages: {},
  }

  selectedDates.forEach(({ date, globalWeek }, periodIndex) => {
    const weekId = `share-design-${scenario}-${date}`
    const scoreId = `score-${weekId}`
    const week: Week = { id: weekId, class_id: CLASS_ID, week_number: globalWeek + 1, period_week_number: periodIndex + 1, period_label: period.label, display_label: `${periodIndex + 1}회차`, class_period_id: period.id, start_date: date, reading_total: 0, vocab_total: 12, homework_total: 4 }
    const weekAnswers: StudentAnswer[] = []
    READING_TYPES.forEach((type, typeIndex) => {
      const result = readingResults(typeIndex, globalWeek, scenario)
      for (let number = 0; number < result.total; number++) {
        const content = type.questions[(number + globalWeek) % type.questions.length]
        const questionId = `${weekId}-reading-${typeIndex}-${number}`
        const isCorrect = number < result.correct
        weekAnswers.push({
          id: `answer-${questionId}`, week_score_id: scoreId, is_correct: isCorrect,
          student_answer: isCorrect ? content.answer : content.answer % 5 + 1, student_answer_text: null,
          ai_feedback: isCorrect ? null : '해설에서 근거 문장을 확인한 뒤, 내가 고른 선지가 글과 어떻게 다른지 한 문장으로 설명해 보세요.',
          exam_question: { id: questionId, week_id: weekId, question_number: weekAnswers.length + 1, sub_label: null, exam_type: 'reading', question_style: 'objective', correct_answer: content.answer, correct_answer_text: null, question_stem: content.stem, passage: content.passage, choices: [...content.choices], explanation: content.explanation, needs_source_image: false, source_image_path: null, exam_question_tag: [{ concept_tag: type.tag }] },
        })
      }
    })
    week.reading_total = weekAnswers.length
    data.studentAnswers.push(...weekAnswers)

    const vocabCorrect = scenario === 'perfect' ? 12 : [9, 10, 8, 10][globalWeek % 4]
    let completedRetakes = 0
    for (let number = 0; number < 12; number++) {
      const source = WORDS[(globalWeek % 2) * 12 + number]
      const word: VocabWord = { id: `${weekId}-word-${number}`, week_id: weekId, number: number + 1, passage_label: number < 6 ? '독해 지문 1' : '독해 지문 2', english_word: source.english, part_of_speech: source.pos, correct_answer: source.meaning, synonyms: [source.synonym], antonyms: source.antonym ? [source.antonym] : [], derivatives: null, example_sentence: source.sentence, example_translation: source.translation }
      const isCorrect = number < vocabCorrect
      const retaken = !isCorrect && globalWeek < 10
      const mastered = retaken && number === vocabCorrect
      if (mastered) completedRetakes++
      data.vocabWords.push(word)
      // 공유 API의 vocabAnswers는 오답만 공개한다. 전체 단어는 vocabWords에 둔다.
      if (!isCorrect) data.vocabAnswers.push({ id: `${weekId}-vocab-answer-${number}`, week_score_id: scoreId, is_correct: false, test_number: number + 1, test_word: source.english, test_source: 'meaning', student_answer: number === 11 ? null : source.wrong, retake_answer: retaken ? mastered ? source.meaning : source.wrong : null, retake_is_correct: retaken ? mastered : null, vocab_word: word })
    }

    data.weeks.push(week)
    data.weekScores.push({ id: scoreId, week_id: weekId, reading_correct: weekAnswers.filter((answer) => answer.is_correct).length, vocab_correct: vocabCorrect, homework_done: scenario === 'perfect' || globalWeek % 4 !== 2 ? 4 : 3, memo: teacherMemo(globalWeek, scenario), vocab_retake_correct: globalWeek < 10 ? completedRetakes : null })
    data.attendance.push({ id: `attendance-${weekId}`, class_id: CLASS_ID, date, status: globalWeek === 4 ? 'absent' : globalWeek === 7 ? 'late' : 'present' })
    if (globalWeek % 2 === 0) data.clinicAttendance.push({ id: `clinic-${weekId}`, clinic_slot_id: 'share-design-clinic', date, status: 'present', clinic_slot: { weekday: '금', starts_at: '18:00:00', ends_at: '18:30:00' } })
    data.classAverages[weekId] = { readingRate: [72, 76, 74, 78][globalWeek % 4], vocabRate: [81, 83, 79, 85][globalWeek % 4] }
  })
  return data
}
