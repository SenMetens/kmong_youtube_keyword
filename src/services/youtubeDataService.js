import { isSupabaseConfigured, supabase } from '../lib/supabase';

const publishedLabel = (value) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
}).format(new Date(value));

const mapTrendingVideo = (row) => ({
  id: row.video_id,
  category: row.category_key,
  title: row.title,
  channel: row.channel_title,
  views: Number(row.view_count || 0),
  viewDelta: Number(row.view_delta || 0),
  likes: Number(row.like_count || 0),
  likeDelta: Number(row.like_delta || 0),
  duration: row.duration_display,
  durationSeconds: Number(row.duration_seconds || 0),
  isShort: typeof row.is_short === 'boolean' ? row.is_short : null,
  published: publishedLabel(row.published_at),
  publishedAt: row.published_at,
  thumbnail: row.thumbnail_url,
  tags: row.tags || [],
  commentsCount: Number(row.comment_count || 0),
  script: '',
  url: row.youtube_url,
  snapshotDate: row.snapshot_date,
  collectedAt: row.collected_at,
});

const mapAnalysis = (row) => ({
  id: row.video_id,
  category: row.category_key || '',
  channel: row.channel_title,
  channelThumbnail: row.channel_thumbnail_url || '',
  title: row.title,
  url: row.youtube_url,
  thumbnail: row.thumbnail_url,
  duration: row.duration_display,
  durationSeconds: Number(row.duration_seconds || 0),
  published: publishedLabel(row.published_at),
  publishedAt: row.published_at,
  views: Number(row.view_count || 0),
  likes: Number(row.like_count || 0),
  commentsCount: Number(row.comment_count || 0),
  tags: row.hashtags || [],
  comments: row.top_comments || [],
  script: row.transcript || '',
  analyzedAt: row.analyzed_at,
});

async function throwFunctionError(error) {
  if (!error) return;
  let message = error.message || 'Function request failed';
  const response = error.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (payload?.error) message = payload.reason ? `${payload.error} (${payload.reason})` : payload.error;
    } catch {
      try {
        const text = await response.clone().text();
        if (text) message = text;
      } catch { /* noop */ }
    }
  }
  throw new Error(message);
}

// PostgREST 서버가 응답을 1000행으로 제한하므로, range로 1000행씩 나눠 모두 받아 합친다.
async function fetchAllTrendingRows() {
  const pageSize = 1000;
  const allRows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('youtube_keyword_master_trending_videos')
      .select('*')
      .order('category_key')
      .order('rank')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break; // 마지막 페이지
  }
  return allRows;
}

export async function fetchYoutubeKeywordMasterData() {
  if (!isSupabaseConfigured) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  const [rows, { data: summary, error: summaryError }, { data: quota }] = await Promise.all([
    fetchAllTrendingRows(),
    supabase.from('youtube_keyword_master_dashboard_summary').select('*').limit(1).maybeSingle(),
    // 쿼터 뷰가 아직 배포되지 않았거나 오늘 사용량이 없으면 조용히 0으로 처리한다.
    supabase.from('youtube_keyword_master_api_quota_status').select('*').limit(1).maybeSingle(),
  ]);
  if (summaryError) throw summaryError;
  return {
    videos: (rows || []).map(mapTrendingVideo),
    summary: {
      ...(summary || {}),
      api_units_used: Number(quota?.data_api_units || 0),
      api_units_limit: Number(quota?.data_api_units_limit || 8000),
    },
  };
}

export async function fetchYoutubeKeywordMasterAnalyses(auth = {}) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-analyze', {
    body: { action: 'list', code: auth.code, deviceId: auth.deviceId },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return (data?.analyses || []).map(mapAnalysis);
}

// 접근 코드 검증. verify-code Edge Function이 코드+기기를 서버에서 확인한다.
// 데모(Supabase 미설정)에서는 게이트를 적용하지 않는다.
export async function verifyAccessCode(code, deviceId) {
  if (!isSupabaseConfigured) return { ok: true };
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-verify-code', { body: { code, deviceId } });
  if (error) return { ok: false, reason: 'error' };
  return data || { ok: false, reason: 'error' };
}

// 관리자: 닉네임(label)으로 새 사용자 코드를 발급받는다. 6자리 코드는 서버가 생성한다.
export async function issueAccessCode(auth = {}, label, maxDevices) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'issue', code: auth.code, deviceId: auth.deviceId, label, maxDevices },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

// 관리자: 발급된 사용자 코드 목록과 각 코드의 접속 기기(IP/브라우저/시각)를 조회한다.
export async function listAccessCodes(auth = {}) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'list', code: auth.code, deviceId: auth.deviceId },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data.codes || [];
}

// 관리자: 특정 코드의 활성/비활성을 전환한다.
export async function setAccessCodeActive(auth = {}, targetCode, isActive) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'set_active', code: auth.code, deviceId: auth.deviceId, targetCode, isActive },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

// 관리자: 특정 코드의 허용 기기 수를 변경한다.
export async function setCodeMaxDevices(auth = {}, targetCode, maxDevices) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'set_max_devices', code: auth.code, deviceId: auth.deviceId, targetCode, maxDevices },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

// 관리자: 특정 코드에 연결된 기기를 모두 초기화(해제)한다. 사용자는 코드를 다시 입력해 재등록한다.
export async function resetCodeDevices(auth = {}, targetCode) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'reset_devices', code: auth.code, deviceId: auth.deviceId, targetCode },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

// 관리자: 특정 코드를 완전히 삭제한다. 연결된 기기 기록도 함께 삭제된다.
export async function deleteAccessCode(auth = {}, targetCode) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-admin', {
    body: { action: 'delete_code', code: auth.code, deviceId: auth.deviceId, targetCode },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function analyzeYoutubeVideo(videoId, auth = {}) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-analyze', { body: { videoId, code: auth.code, deviceId: auth.deviceId } });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return mapAnalysis(data.analysis);
}

// 크롬 확장이 추출한 자막을 서버에 저장하고 갱신된 분석 결과를 돌려받는다.
export async function saveYoutubeTranscript(videoId, transcript, auth = {}) {
  if (!isSupabaseConfigured) throw new Error('Supabase가 연결되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-analyze', { body: { videoId, transcript, code: auth.code, deviceId: auth.deviceId } });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
  return mapAnalysis(data.analysis);
}

export async function clearYoutubeKeywordMasterAnalyses(auth = {}) {
  if (!isSupabaseConfigured) return;
  const { data, error } = await supabase.functions.invoke('youtube-keyword-master-clear-analyses', {
    body: { confirm: 'DELETE_ALL_ANALYSES', code: auth.code, deviceId: auth.deviceId },
  });
  if (error) await throwFunctionError(error);
  if (data?.error) throw new Error(data.error);
}
