export const categories = [
  { id: 'all', label: '전체', icon: 'LayoutGrid' },
  // 카테고리 구분 없는 유튜브 전체 '인기 급상승' 차트 ('전체' 집계에서는 중복 방지를 위해 제외)
  { id: 'trending', label: '인급동🔥', icon: 'Flame' },
  { id: 'entertainment', label: '엔터테인먼트', icon: 'Clapperboard' },
  { id: 'music', label: '음악', icon: 'Music2' },
  { id: 'game', label: '게임', icon: 'Gamepad2' },
  { id: 'sports', label: '스포츠', icon: 'Trophy' },
  { id: 'news', label: '뉴스·정치', icon: 'Newspaper' },
  { id: 'education', label: '교육', icon: 'GraduationCap' },
  { id: 'tech', label: '과학기술', icon: 'Cpu' },
  { id: 'travel', label: '여행·이벤트', icon: 'Plane' },
  // YouTube 카테고리 26은 '노하우/스타일'(Howto & Style)이며 유튜브에 별도 '요리' 카테고리는 없다.
  { id: 'food', label: '노하우·스타일', icon: 'Palette' },
  { id: 'topic_game', label: '게임 발굴', icon: 'Gamepad2' },
  { id: 'topic_travel', label: '여행 발굴', icon: 'Plane' },
  { id: 'topic_vlog', label: '브이로그', icon: 'UserRound' },
  { id: 'topic_mukbang', label: '먹방·맛집', icon: 'Utensils' },
  { id: 'topic_finance', label: '재테크', icon: 'WalletCards' },
  { id: 'topic_ai', label: 'AI', icon: 'Sparkles' },
  { id: 'topic_parenting', label: '육아', icon: 'Baby' },
  { id: 'topic_shopping', label: '쇼핑·리뷰', icon: 'ShoppingBag' },
];

const commonComments = [
  { author: '오늘도성장중', text: '딱 찾고 있던 내용이에요. 핵심만 명확해서 끝까지 봤습니다!', likes: 3841 },
  { author: 'Daily Note', text: '이 포인트는 몇 번을 다시 봐도 좋네요. 다음 편도 기대할게요.', likes: 2140 },
  { author: '김유튜브', text: '편집도 좋고 설명도 이해하기 쉬워서 바로 구독했습니다 🙌', likes: 976 },
];

const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=82`;

export const videos = [
  {
    id: 'yt-001', category: 'entertainment', title: '퇴근 후 단 10분, 모두가 기다린 시즌 마지막 이야기', channel: '스튜디오 오늘',
    views: 2841052, viewDelta: 428540, likes: 96420, likeDelta: 12840, duration: '18:24', published: '2026. 06. 30.',
    thumbnail: img('photo-1485846234645-a62644f84728'), tags: ['#예능', '#웹콘텐츠', '#스튜디오오늘'], commentsCount: 8421,
    script: '오늘은 지난 시즌을 마무리하며 시청자 여러분이 가장 많이 보내주신 질문에 답해보겠습니다. 첫 번째 질문은…',
  },
  {
    id: 'yt-002', category: 'music', title: '새벽을 걷는 사람들을 위한 플레이리스트 | 2 HOURS', channel: 'MELLOW ROOM',
    views: 1984720, viewDelta: 318220, likes: 84210, likeDelta: 9720, duration: '2:03:18', published: '2026. 06. 28.',
    thumbnail: img('photo-1493225457124-a3eb161ffa5f'), tags: ['#플레이리스트', '#새벽감성', '#집중음악'], commentsCount: 3612,
    script: '이 플레이리스트는 조용한 새벽, 혼자 걷는 시간을 위해 만들었습니다. 편안한 시간 보내세요.',
  },
  {
    id: 'yt-003', category: 'game', title: '고인물도 처음 보는 숨겨진 엔딩을 발견했습니다', channel: '게임연구소',
    views: 1768940, viewDelta: 294300, likes: 72680, likeDelta: 8310, duration: '26:08', published: '2026. 07. 01.',
    thumbnail: img('photo-1542751371-adc38448a05e'), tags: ['#게임공략', '#숨겨진엔딩'], commentsCount: 5740,
    script: '오늘은 업데이트 이후 새롭게 발견된 히든 루트를 따라가 보겠습니다. 시작 지점에서 오른쪽 문을…',
  },
  {
    id: 'yt-004', category: 'sports', title: '경기 종료 3초 전, 믿을 수 없는 역전 드라마', channel: 'SPORTS LIVE',
    views: 1523040, viewDelta: 267820, likes: 51430, likeDelta: 6850, duration: '12:42', published: '2026. 07. 01.',
    thumbnail: img('photo-1461896836934-ffe607ba8211'), tags: ['#하이라이트', '#역전승', '#스포츠'], commentsCount: 6924,
    script: '이제 남은 시간은 단 3초. 마지막 공격 기회에서 공을 잡은 선수는 그대로 슛을 시도합니다.',
  },
  {
    id: 'yt-005', category: 'tech', title: 'AI 에이전트, 이제 진짜 일을 시켜봤습니다', channel: '테크로그',
    views: 1186200, viewDelta: 218930, likes: 48120, likeDelta: 5920, duration: '16:55', published: '2026. 06. 29.',
    thumbnail: img('photo-1518770660439-4636190af475'), tags: ['#AI', '#생산성', '#테크리뷰'], commentsCount: 2830,
    script: 'AI 에이전트가 단순한 답변을 넘어 실제 업무를 어디까지 처리할 수 있는지 세 가지 실험으로 확인해봤습니다.',
  },
  {
    id: 'yt-006', category: 'food', title: '실패 없는 여름 김치, 이 순서만 기억하세요', channel: '우리집 한끼',
    views: 984220, viewDelta: 186400, likes: 39210, likeDelta: 4880, duration: '11:36', published: '2026. 06. 30.',
    thumbnail: img('photo-1556911220-bff31c812dba'), tags: ['#집밥', '#김치레시피', '#한식'], commentsCount: 1942,
    script: '오늘은 여름에도 아삭함이 오래가는 김치를 담가볼게요. 가장 중요한 건 소금물의 농도입니다.',
  },
  {
    id: 'yt-007', category: 'news', title: '오늘 아침 꼭 알아야 할 경제 이슈 5분 정리', channel: '뉴스 브리핑',
    views: 862510, viewDelta: 162110, likes: 28410, likeDelta: 3250, duration: '5:14', published: '2026. 07. 02.',
    thumbnail: img('photo-1495020689067-958852a7765e'), tags: [], commentsCount: 2471, script: '',
  },
  {
    id: 'yt-008', category: 'education', title: '영어가 갑자기 들리기 시작하는 30개 문장', channel: '하루영어',
    views: 724890, viewDelta: 139850, likes: 46870, likeDelta: 5370, duration: '20:10', published: '2026. 06. 27.',
    thumbnail: img('photo-1503676260728-1c00da094a0b'), tags: ['#영어회화', '#쉐도잉'], commentsCount: 1872,
    script: '첫 번째 문장입니다. I was just about to call you. 나는 막 너에게 전화하려던 참이었어.',
  },
  {
    id: 'yt-009', category: 'travel', title: '기차로만 떠나는 스위스 소도시 4박 5일', channel: '여행하는 민',
    views: 693120, viewDelta: 122630, likes: 35220, likeDelta: 4160, duration: '24:31', published: '2026. 06. 25.',
    thumbnail: img('photo-1527004013197-933c4bb611b3'), tags: ['#스위스여행', '#기차여행', '#브이로그'], commentsCount: 1654,
    script: '취리히 중앙역에서 오늘의 여정을 시작합니다. 첫 번째 목적지는 호숫가의 작은 마을 슈피츠입니다.',
  },
  {
    id: 'yt-010', category: 'entertainment', title: '100명의 선택이 하나로 모이면 벌어지는 일', channel: 'PROJECT 100',
    views: 631840, viewDelta: 113720, likes: 26740, likeDelta: 3640, duration: '14:09', published: '2026. 06. 29.',
    thumbnail: img('photo-1514525253161-7a46d19cd819'), tags: ['#실험카메라', '#프로젝트'], commentsCount: 2428,
    script: '서로 모르는 100명에게 같은 질문을 던졌습니다. 과연 모두의 선택이 한곳으로 모일 수 있을까요?',
  },
  {
    id: 'yt-011', category: 'music', title: 'LIVE CLIP — 파도 위의 우리', channel: 'Blue Note',
    views: 589260, viewDelta: 98470, likes: 41560, likeDelta: 4290, duration: '4:17', published: '2026. 07. 01.',
    thumbnail: img('photo-1524368535928-5b5e00ddc76b'), tags: ['#라이브클립', '#인디음악'], commentsCount: 3215,
    script: '',
  },
  {
    id: 'yt-012', category: 'game', title: '단 한 번도 맞지 않고 최종 보스 깨기', channel: '겜스트 G',
    views: 544780, viewDelta: 87350, likes: 23890, likeDelta: 2980, duration: '31:20', published: '2026. 06. 30.',
    thumbnail: img('photo-1598550476439-6847785fcea6'), tags: ['#노히트', '#보스전'], commentsCount: 2741,
    script: '오늘 도전은 노 대미지 최종 보스 클리어입니다. 장비는 기본 세팅만 사용하겠습니다.',
  },
  {
    id: 'yt-013', category: 'sports', title: '국가대표가 알려주는 러닝 자세의 정석', channel: 'RUN BETTER',
    views: 498310, viewDelta: 76910, likes: 31420, likeDelta: 3410, duration: '9:48', published: '2026. 06. 24.',
    thumbnail: img('photo-1552674605-db6ffd4facb5'), tags: ['#러닝', '#달리기자세'], commentsCount: 1530,
    script: '러닝에서 가장 흔한 실수는 보폭을 무리하게 넓히는 것입니다. 발은 몸의 중심 아래에 착지해야 합니다.',
  },
  {
    id: 'yt-014', category: 'education', title: '복잡한 생각을 1장으로 정리하는 법', channel: '생각의 도구',
    views: 431520, viewDelta: 68450, likes: 29640, likeDelta: 3190, duration: '13:22', published: '2026. 06. 26.',
    thumbnail: img('photo-1434030216411-0b793f4b4173'), tags: ['#생각정리', '#노트법'], commentsCount: 1385,
    script: '생각이 복잡할수록 먼저 핵심 질문 하나를 적어보세요. 그다음 원인과 결과를 양옆으로 나눕니다.',
  },
  {
    id: 'yt-015', category: 'tech', title: '스마트폰 카메라, 설정 하나로 달라집니다', channel: '기어랩',
    views: 397120, viewDelta: 58930, likes: 18420, likeDelta: 2160, duration: '8:04', published: '2026. 06. 28.',
    thumbnail: img('photo-1511707171634-5f897ff02aa9'), tags: [], commentsCount: 946,
    script: '카메라 앱을 열고 격자 설정부터 켜주세요. 화면을 9개 영역으로 나누면 구도가 훨씬 안정적입니다.',
  },
  {
    id: 'yt-016', category: 'travel', title: '사람들이 모르는 서울의 조용한 산책길 7곳', channel: '도시산책자',
    views: 358740, viewDelta: 52220, likes: 24590, likeDelta: 2840, duration: '17:40', published: '2026. 06. 23.',
    thumbnail: img('photo-1517154421773-0529f29ea451'), tags: ['#서울여행', '#산책코스'], commentsCount: 1182,
    script: '첫 번째 장소는 성북동 끝자락에 있는 작은 산책길입니다. 지하철역에서 천천히 걸어 15분이면 도착합니다.',
  },
  {
    id: 'yt-017', category: 'food', title: '냉장고 재료로 만드는 10분 덮밥', channel: '키친 101',
    views: 318620, viewDelta: 47120, likes: 17680, likeDelta: 1930, duration: '10:02', published: '2026. 06. 27.',
    thumbnail: img('photo-1547592180-85f173990554'), tags: ['#간단요리', '#덮밥'], commentsCount: 824,
    script: '양파 반 개와 달걀 두 개만 있으면 됩니다. 팬을 중불로 달군 뒤 양파부터 투명해질 때까지 볶아주세요.',
  },
  {
    id: 'yt-018', category: 'news', title: '데이터로 보는 이번 주 글로벌 트렌드', channel: 'Insight Now',
    views: 284970, viewDelta: 41380, likes: 12310, likeDelta: 1510, duration: '7:35', published: '2026. 07. 01.',
    thumbnail: img('photo-1454165804606-c3d57bc86b40'), tags: ['#글로벌이슈', '#데이터'], commentsCount: 724,
    script: '이번 주 가장 큰 움직임을 보인 세 가지 지표를 살펴보겠습니다. 먼저 글로벌 소비 심리 지수입니다.',
  },
];

export const enrichVideo = (video) => ({
  ...video,
  url: `https://www.youtube.com/watch?v=${video.id}`,
  comments: commonComments.map((comment, index) => ({ ...comment, likes: comment.likes - index * (video.id.charCodeAt(video.id.length - 1) % 31) })),
  analyzedAt: new Date().toISOString(),
});
