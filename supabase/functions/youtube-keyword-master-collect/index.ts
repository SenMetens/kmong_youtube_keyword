import { createClient } from 'npm:@supabase/supabase-js@2';

type CollectionCategory = { key: string; youtubeId?: string };
type TopicCategory = CollectionCategory & { queries: string[] };

const categories: CollectionCategory[] = [
  // youtubeId가 비어 있으면 카테고리 구분 없는 유튜브 전체 '인기 급상승' 차트
  { key: 'trending', youtubeId: '' },
  { key: 'entertainment', youtubeId: '24' },
  { key: 'music', youtubeId: '10' },
  { key: 'game', youtubeId: '20' },
  { key: 'sports', youtubeId: '17' },
  { key: 'news', youtubeId: '25' },
  { key: 'education', youtubeId: '27' },
  { key: 'tech', youtubeId: '28' },
  { key: 'travel', youtubeId: '19' },
  { key: 'food', youtubeId: '26' },
];

const topicCategories: TopicCategory[] = [
  { key: 'topic_game', queries: ['신작게임', '모바일게임', '게임공략', '로블록스', '마인크래프트'] },
  { key: 'topic_travel', queries: ['국내여행', '일본여행', '혼자여행', '여행브이로그'] },
  { key: 'topic_vlog', queries: ['직장인브이로그', '대학생브이로그', '자취브이로그', '일상브이로그'] },
  { key: 'topic_mukbang', queries: ['먹방', '맛집', '자취요리', '편의점음식'] },
  { key: 'topic_finance', queries: ['재테크', '주식', '부동산', '절약', '경제공부'] },
  { key: 'topic_ai', queries: ['AI툴', '챗GPT', '자동화', '생산성'] },
  { key: 'topic_parenting', queries: ['육아', '아기', '초등맘', '육아템'] },
  { key: 'topic_shopping', queries: ['제품리뷰', '내돈내산', '쿠팡추천', '살림템'] },
];

const RESULTS_PER_PAGE = 50;
// 카테고리당 차트 수집 상한. 유튜브 인기 차트는 최대 200위 안팎까지 제공된다.
const CHART_LIMIT = 200;
// 검색 발견 트랙: mostPopular 차트에 거의 실리지 않는 쇼츠·상승 영상을 search.list로 직접 찾는다.
// 검색 1회 = 실제 100유닛이라 매 슬롯 실행은 과함 → 아래 KST 슬롯에서만 발견을 실행하고,
// 발견된 영상은 이후 모든 run에서 videos.list(50개당 1유닛)로 이어 추적해 증가량을 계속 갱신한다.
const DISCOVERY_SLOT_HOURS_KST = [8, 20];
const TOPIC_DISCOVERY_SLOT_HOURS_KST = [20];
const DISCOVERY_WINDOW_DAYS = 7; // 최근 N일 업로드만 발견 대상(역주행 영상은 이어추적·차트가 담당)
const CARRY_LIMIT_PER_CATEGORY = 400; // 직전 run에서 이어 추적할 카테고리당 영상 수 상한(추적 풀 무한 성장 방지)
const SEARCHES_PER_DISCOVERY_TARGET = 2;

const jsonHeaders = { 'Content-Type': 'application/json' };

function readHourList(name: string, fallback: number[]) {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const hours = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return hours.length ? [...new Set(hours)] : fallback;
}

function readKeyMap(name: string) {
  const value = Deno.env.get(name);
  if (!value) return {} as Record<string, string>;
  try { return JSON.parse(value) as Record<string, string>; } catch { return {}; }
}

function getAdminKey() {
  return readKeyMap('SUPABASE_SECRET_KEYS').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function authorizationMode(request: Request) {
  const provided = request.headers.get('apikey') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (provided && provided === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return 'secret';
  if (provided && Object.values(readKeyMap('SUPABASE_SECRET_KEYS')).includes(provided)) return 'secret';
  if (provided && Object.values(readKeyMap('SUPABASE_PUBLISHABLE_KEYS')).includes(provided)) return 'publishable';
  return null;
}

function parseDuration(value: string) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  const hours = Number(match?.[1] || 0);
  const minutes = Number(match?.[2] || 0);
  const seconds = Number(match?.[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function displayDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function koreaDate() {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function youtubeQuotaDate() {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Los_Angeles',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function koreaCollectionSlot() {
  const koreaOffset = 9 * 60 * 60 * 1000;
  const koreaNow = new Date(Date.now() + koreaOffset);
  const slotHour = Math.floor(koreaNow.getUTCHours() / 4) * 4;
  const koreaSlot = Date.UTC(
    koreaNow.getUTCFullYear(),
    koreaNow.getUTCMonth(),
    koreaNow.getUTCDate(),
    slotHour,
  );
  return new Date(koreaSlot - koreaOffset).toISOString();
}

async function searchPopularVideos(category: CollectionCategory, youtubeApiKey: string) {
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fallbackQuery = category.key === 'education' ? '교육' : category.key === 'travel' ? '여행' : category.key;
  const searchParams = new URLSearchParams({
    part: 'snippet', type: 'video', regionCode: 'KR', relevanceLanguage: 'ko',
    q: fallbackQuery, order: 'viewCount', publishedAfter,
    maxResults: String(RESULTS_PER_PAGE), key: youtubeApiKey,
  });
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  const searchPayload = await searchResponse.json();
  if (!searchResponse.ok) throw new Error(searchPayload?.error?.message || searchResponse.statusText);

  const videoIds = (searchPayload.items || []).map((item: any) => item.id?.videoId).filter(Boolean);
  if (!videoIds.length) return [];

  const detailItems = await fetchVideoDetails(videoIds, youtubeApiKey);
  const details = new Map(detailItems.map((item: any) => [item.id, item]));
  return videoIds.map((videoId: string) => details.get(videoId)).filter(Boolean);
}

// videos.list 상세 조회(50개 배치당 1유닛). 차트 폴백·검색 발견·이어추적이 공용으로 쓴다.
async function fetchVideoDetails(videoIds: string[], youtubeApiKey: string) {
  const items: any[] = [];
  for (let start = 0; start < videoIds.length; start += RESULTS_PER_PAGE) {
    const batch = videoIds.slice(start, start + RESULTS_PER_PAGE);
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,statistics,player', maxWidth: '640', id: batch.join(','), key: youtubeApiKey,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || response.statusText);
    items.push(...(payload.items || []));
  }
  return items;
}

// 카테고리별 검색 발견: 쇼츠 후보(4분 미만) 1회 + 전체 길이 1회 = 검색 2회.
// q 없이 필터만으로 최근 N일 조회수 상위를 가져온다. Shorts 최종 판별(세로+180초)은 상세 수집 후 동일 적용된다.
async function discoverCategoryIds(category: CollectionCategory, youtubeApiKey: string) {
  if (!category.youtubeId) return [];
  const publishedAfter = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const variants: Record<string, string>[] = [{ videoDuration: 'short' }, {}];
  const ids: string[] = [];
  for (const variant of variants) {
    const params = new URLSearchParams({
      part: 'id', type: 'video', regionCode: 'KR', relevanceLanguage: 'ko',
      order: 'viewCount', publishedAfter, videoCategoryId: category.youtubeId,
      maxResults: String(RESULTS_PER_PAGE), key: youtubeApiKey, ...variant,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || response.statusText);
    ids.push(...(payload.items || []).map((item: any) => item.id?.videoId).filter(Boolean));
  }
  return ids;
}

function kstHour(slotIso: string) {
  return (new Date(slotIso).getUTCHours() + 9) % 24;
}

function kstDayIndex(slotIso: string) {
  const koreaOffset = 9 * 60 * 60 * 1000;
  return Math.floor((new Date(slotIso).getTime() + koreaOffset) / (24 * 60 * 60 * 1000));
}

function topicQueryForSlot(topic: TopicCategory, slotIso: string) {
  return topic.queries[kstDayIndex(slotIso) % topic.queries.length];
}

function topicRegularDurationForSlot(slotIso: string) {
  return kstDayIndex(slotIso) % 2 === 0 ? 'medium' : 'long';
}

async function discoverTopicIds(topic: TopicCategory, youtubeApiKey: string, slotIso: string) {
  const publishedAfter = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const variants: Record<string, string>[] = [
    { videoDuration: 'short' },
    { videoDuration: topicRegularDurationForSlot(slotIso) },
  ];
  const ids: string[] = [];
  for (const variant of variants) {
    const params = new URLSearchParams({
      part: 'id', type: 'video', regionCode: 'KR', relevanceLanguage: 'ko',
      q: topicQueryForSlot(topic, slotIso), order: 'viewCount', publishedAfter,
      maxResults: String(RESULTS_PER_PAGE), key: youtubeApiKey, ...variant,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || response.statusText);
    ids.push(...(payload.items || []).map((item: any) => item.id?.videoId).filter(Boolean));
  }
  return ids;
}

function isDiscoverySlot(slotIso: string) {
  return DISCOVERY_SLOT_HOURS_KST.includes(kstHour(slotIso));
}

function isTopicDiscoverySlot(slotIso: string) {
  return readHourList('TOPIC_DISCOVERY_SLOT_HOURS_KST', TOPIC_DISCOVERY_SLOT_HOURS_KST).includes(kstHour(slotIso));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: jsonHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
  const authMode = authorizationMode(request);
  if (!authMode) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY') || '';
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey || !youtubeApiKey) {
    return new Response(JSON.stringify({ error: 'Required server secrets are missing' }), { status: 500, headers: jsonHeaders });
  }

  const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false } });
  const collectionDate = koreaDate();
  const collectionSlot = koreaCollectionSlot();
  const { data: existingRun } = await supabase
    .from('youtube_keyword_master_collection_runs')
    .select('id,status')
    .eq('collection_slot', collectionSlot)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();

  let force = false;
  try { force = Boolean((await request.json())?.force); } catch { /* empty body */ }
  if (force && authMode !== 'secret') {
    return new Response(JSON.stringify({ error: 'Force collection requires a server secret key' }), { status: 403, headers: jsonHeaders });
  }
  if (existingRun && !force) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'Already collected this slot' }), { headers: jsonHeaders });
  }

  const { data: run, error: runError } = await supabase
    .from('youtube_keyword_master_collection_runs')
    .insert({ collection_date: collectionDate, collection_slot: collectionSlot, status: 'running' })
    .select('id')
    .single();
  if (runError?.code === '23505') {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'Collection already running' }), { headers: jsonHeaders });
  }
  if (runError) return new Response(JSON.stringify({ error: runError.message }), { status: 500, headers: jsonHeaders });

  try {
    // 직전 run에서 성장 중이던 영상을 카테고리별 상한만큼 이어 추적한다.
    // (대시보드 뷰는 마지막 완료 run만 보여주므로, 이어 붙이지 않으면 발견 영상이 다음 run에서 사라진다)
    const discoveryCategories = categories.filter((category) => category.youtubeId);
    const trackedCategories = [...discoveryCategories, ...topicCategories];
    const carriedByCategory = new Map<string, string[]>();
    await Promise.all(trackedCategories.map(async (category) => {
      const { data } = await supabase
        .from('youtube_keyword_master_trending_videos')
        .select('video_id')
        .eq('category_key', category.key)
        .order('view_delta', { ascending: false })
        .order('view_count', { ascending: false })
        .limit(CARRY_LIMIT_PER_CATEGORY);
      if (data?.length) carriedByCategory.set(category.key, data.map((row) => row.video_id));
    }));
    const carriedCount = [...carriedByCategory.values()].reduce((sum, list) => sum + list.length, 0);

    // 쿼터 예약: 차트 40회+여유(42)는 기존과 동일. 발견 검색은 호출 수(80/일)와 함께
    // 실제 유닛(100/회)도 합산해 분석과 같은 지갑(8,000유닛/일)을 쓰게 한다.
    // 상세 조회 유닛은 발견 최대치+이어추적 분량의 상한으로 과예약한다(안전 방향).
    const wantDiscovery = isDiscoverySlot(collectionSlot) || force;
    const wantTopicDiscovery = isTopicDiscoverySlot(collectionSlot) || force;
    const categorySearchCount = discoveryCategories.length * SEARCHES_PER_DISCOVERY_TARGET;
    const topicSearchCount = topicCategories.length * SEARCHES_PER_DISCOVERY_TARGET;
    const detailUnitsFor = (searchCount: number) => Math.ceil((searchCount * RESULTS_PER_PAGE + carriedCount) / RESULTS_PER_PAGE) + 2;
    const reservePlans = [
      ...(wantDiscovery && wantTopicDiscovery ? [{
        units: 42 + (categorySearchCount + topicSearchCount) * 100 + detailUnitsFor(categorySearchCount + topicSearchCount),
        searches: 2 + categorySearchCount + topicSearchCount,
        categoryDiscovery: true,
        topicDiscovery: true,
      }] : []),
      ...(wantDiscovery ? [{
        units: 42 + categorySearchCount * 100 + detailUnitsFor(categorySearchCount),
        searches: 2 + categorySearchCount,
        categoryDiscovery: true,
        topicDiscovery: false,
      }] : []),
      ...(wantTopicDiscovery ? [{
        units: 42 + topicSearchCount * 100 + detailUnitsFor(topicSearchCount),
        searches: 2 + topicSearchCount,
        categoryDiscovery: false,
        topicDiscovery: true,
      }] : []),
      {
        units: 42 + detailUnitsFor(0),
        searches: 2,
        categoryDiscovery: false,
        topicDiscovery: false,
      },
    ];
    let plan: { categoryDiscovery: boolean; topicDiscovery: boolean } | undefined;
    for (const candidate of reservePlans) {
      const { data: quotaReserved, error: quotaError } = await supabase.rpc('youtube_keyword_master_reserve_api_quota', {
        p_usage_date: youtubeQuotaDate(), p_units: candidate.units, p_search_calls: candidate.searches,
      });
      if (quotaError) throw quotaError;
      if (quotaReserved) { plan = candidate; break; }
    }
    if (!plan) throw new Error('Daily YouTube API safety limit reached');

    const errors: string[] = [];
    const chartResponses = await Promise.all(categories.map(async (category) => {
      // 차트를 페이지(50개) 단위로 최대 CHART_LIMIT(200개)까지 수집한다.
      // 쇼츠가 차트 상위를 독점한 카테고리에서도 뒤 순위의 일반 영상을 확보하기 위함.
      const items: any[] = [];
      let pageToken = '';
      while (items.length < CHART_LIMIT) {
        const params = new URLSearchParams({
          part: 'snippet,contentDetails,statistics,player', maxWidth: '640', chart: 'mostPopular', regionCode: 'KR',
          maxResults: String(RESULTS_PER_PAGE), key: youtubeApiKey,
        });
        if (category.youtubeId) params.set('videoCategoryId', category.youtubeId);
        if (pageToken) params.set('pageToken', pageToken);
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
        const payload = await response.json();
        if (!response.ok) {
          // 첫 페이지부터 실패한 카테고리만 검색 폴백 시도 (전체 급상승은 폴백 무의미)
          if (items.length === 0 && category.youtubeId) {
            try {
              const fallbackItems = await searchPopularVideos(category, youtubeApiKey);
              if (fallbackItems.length) return { category, items: fallbackItems };
            } catch (fallbackError) {
              const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
              errors.push(`${category.key}: ${message}`);
              return { category, items: [] };
            }
          }
          if (items.length === 0) errors.push(`${category.key}: ${payload?.error?.message || response.statusText}`);
          break; // 뒤 페이지 실패는 지금까지 모은 것으로 진행
        }
        items.push(...(payload.items || []));
        pageToken = payload.nextPageToken || '';
        if (!pageToken) break;
      }
      return { category, items };
    }));
    const responses = [
      ...chartResponses,
      ...topicCategories.map((category) => ({ category, items: [] as any[] })),
    ];

    // 발견 검색 실행(발견 슬롯 또는 force) 후, 발견+이어추적 대상의 상세를 한 번에 수집해
    // 카테고리별 차트 뒤에 병합한다. 이후 스냅샷·Shorts 판별은 기존 로직을 그대로 탄다.
    const discoveredByCategory = new Map<string, string[]>();
    if (plan.categoryDiscovery) {
      await Promise.all(discoveryCategories.map(async (category) => {
        try {
          discoveredByCategory.set(category.key, await discoverCategoryIds(category, youtubeApiKey));
        } catch (discoveryError) {
          const message = discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
          errors.push(`${category.key} 발견: ${message}`);
        }
      }));
    }
    if (plan.topicDiscovery) {
      await Promise.all(topicCategories.map(async (category) => {
        try {
          discoveredByCategory.set(category.key, await discoverTopicIds(category, youtubeApiKey, collectionSlot));
        } catch (discoveryError) {
          const message = discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
          errors.push(`${category.key} 발견: ${message}`);
        }
      }));
    }
    const chartVideoKeys = new Set<string>();
    for (const { category, items } of responses) {
      items.forEach((item: any) => chartVideoKeys.add(`${item.id}:${category.key}`));
    }
    const extraIdsByCategory = new Map<string, string[]>();
    const extraIdSet = new Set<string>();
    for (const category of trackedCategories) {
      const merged = [...(discoveredByCategory.get(category.key) || []), ...(carriedByCategory.get(category.key) || [])];
      const unique = [...new Set(merged)].filter((videoId) => !chartVideoKeys.has(`${videoId}:${category.key}`));
      if (!unique.length) continue;
      extraIdsByCategory.set(category.key, unique);
      unique.forEach((videoId) => extraIdSet.add(videoId));
    }
    if (extraIdSet.size) {
      try {
        const detailItems = await fetchVideoDetails([...extraIdSet], youtubeApiKey);
        const detailMap = new Map(detailItems.map((item: any) => [item.id, item]));
        for (const { category, items } of responses) {
          const extras = (extraIdsByCategory.get(category.key) || []).map((videoId) => detailMap.get(videoId)).filter(Boolean);
          items.push(...extras);
        }
      } catch (detailError) {
        const message = detailError instanceof Error ? detailError.message : String(detailError);
        errors.push(`상세 수집: ${message}`);
      }
    }

    const videoMap = new Map<string, Record<string, unknown>>();
    const snapshots: Record<string, unknown>[] = [];
    // 같은 upsert payload 안에 (video, category) 중복이 있으면 Postgres가 거부하므로 방어한다.
    const snapshotKeys = new Set<string>();
    for (const { category, items } of responses) {
      items.forEach((item: any, index: number) => {
        const snapshotKey = `${item.id}:${category.key}`;
        if (snapshotKeys.has(snapshotKey)) return;
        snapshotKeys.add(snapshotKey);
        const seconds = parseDuration(item.contentDetails?.duration || 'PT0S');
        // Shorts 판별: maxWidth 지정 시 player.embedWidth/embedHeight가 실제 비율로 반환됨.
        // 세로 비율 + 3분(180초) 이하일 때만 Shorts로 본다. 세로 라이브·롱폼은 제외. 값이 없으면 null.
        const embedWidth = Number(item.player?.embedWidth || 0);
        const embedHeight = Number(item.player?.embedHeight || 0);
        const isShort = embedWidth > 0 && embedHeight > 0 ? (embedHeight > embedWidth && seconds > 0 && seconds <= 180) : null;
        videoMap.set(item.id, {
          video_id: item.id,
          category_key: category.key,
          youtube_category_id: item.snippet?.categoryId || category.youtubeId || '',
          channel_id: item.snippet?.channelId || '',
          channel_title: item.snippet?.channelTitle || '',
          title: item.snippet?.title || '',
          description: item.snippet?.description || '',
          thumbnail_url: item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.standard?.url || item.snippet?.thumbnails?.high?.url || '',
          duration_iso8601: item.contentDetails?.duration || 'PT0S',
          duration_seconds: seconds,
          duration_display: displayDuration(seconds),
          is_short: isShort,
          published_at: item.snippet?.publishedAt,
          youtube_url: `https://www.youtube.com/watch?v=${item.id}`,
          tags: item.snippet?.tags || [],
        });
        snapshots.push({
          video_id: item.id,
          category_key: category.key,
          run_id: run.id,
          snapshot_date: collectionDate,
          rank: index + 1,
          view_count: Number(item.statistics?.viewCount || 0),
          like_count: Number(item.statistics?.likeCount || 0),
          comment_count: Number(item.statistics?.commentCount || 0),
          collected_at: new Date().toISOString(),
        });
      });
    }

    const videos = [...videoMap.values()];
    if (videos.length) {
      const { error } = await supabase.from('youtube_keyword_master_videos').upsert(videos, { onConflict: 'video_id' });
      if (error) throw error;
      const { error: snapshotError } = await supabase
        .from('youtube_keyword_master_video_snapshots')
        .upsert(snapshots, { onConflict: 'video_id,category_key,run_id' });
      if (snapshotError) throw snapshotError;
    }

    const status = videos.length === 0 ? 'failed' : errors.length ? 'partial' : 'completed';
    await supabase.from('youtube_keyword_master_collection_runs').update({
      status,
      video_count: videos.length,
      error_message: errors.length ? errors.join(' | ') : null,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id);

    // 7일(한국시간) 지난 스냅샷·수집 기록·고아 영상 정리 (분석 결과는 보존)
    if (status !== 'failed') {
      const { error: cleanupError } = await supabase.rpc('youtube_keyword_master_cleanup', { p_keep_days: 7 });
      if (cleanupError) console.log(`[cleanup] ${cleanupError.message}`);
    }

    return new Response(JSON.stringify({ ok: status !== 'failed', status, videoCount: videos.length, errors }), {
      status: status === 'failed' ? 502 : 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('youtube_keyword_master_collection_runs').update({
      status: 'failed', error_message: message, completed_at: new Date().toISOString(),
    }).eq('id', run.id);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
});
