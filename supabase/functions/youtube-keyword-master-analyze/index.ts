import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function readKeyMap(name: string) {
  const value = Deno.env.get(name);
  if (!value) return {} as Record<string, string>;
  try { return JSON.parse(value) as Record<string, string>; } catch { return {}; }
}

function isAuthorized(request: Request) {
  const provided = request.headers.get('apikey');
  const allowed = [...Object.values(readKeyMap('SUPABASE_PUBLISHABLE_KEYS')), ...Object.values(readKeyMap('SUPABASE_SECRET_KEYS'))];
  return Boolean(provided && allowed.includes(provided));
}

function getAdminKey() {
  return readKeyMap('SUPABASE_SECRET_KEYS').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || '';
}

// 접근 코드+기기 검증(verify-code 함수와 동일 로직, 배포 단위 분리로 중복 정의).
// 유효/활성/미만료 코드이고 기기가 이미 바인딩됐거나 허용 기기 수 미만일 때만 통과한다.
async function verifyAccessCode(supabase: any, code: string, deviceId: string, ip: string, userAgent: string) {
  if (!/^[0-9]{6}$/.test(code) || !deviceId) return { ok: false, reason: 'invalid' };
  const { data: record, error } = await supabase
    .from('youtube_keyword_master_access_codes')
    .select('code, max_devices, is_active, expires_at, is_admin')
    .eq('code', code)
    .maybeSingle();
  if (error) return { ok: false, reason: 'error' };
  if (!record || !record.is_active) return { ok: false, reason: 'invalid' };
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  const { data: existing } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id')
    .eq('code', code)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from('youtube_keyword_master_code_devices')
      .update({ last_seen: new Date().toISOString(), ip, user_agent: userAgent })
      .eq('id', existing.id);
    return { ok: true, isAdmin: record.is_admin === true };
  }
  const { count } = await supabase
    .from('youtube_keyword_master_code_devices')
    .select('id', { count: 'exact', head: true })
    .eq('code', code);
  if ((count || 0) >= record.max_devices) return { ok: false, reason: 'device_limit' };
  const { error: insertError } = await supabase
    .from('youtube_keyword_master_code_devices')
    .insert({ code, device_id: deviceId, ip, user_agent: userAgent });
  if (insertError && String(insertError.code) !== '23505') return { ok: false, reason: 'error' };
  return { ok: true, isAdmin: record.is_admin === true };
}

// 유튜브 카테고리 ID → 서비스 카테고리 키 (collect의 목록과 동일하게 유지)
const YT_CATEGORY_TO_KEY: Record<string, string> = {
  '24': 'entertainment', '10': 'music', '20': 'game', '17': 'sports',
  '25': 'news', '27': 'education', '28': 'tech', '19': 'travel', '26': 'food',
};

function parseDuration(value: string) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return Number(match?.[1] || 0) * 3600 + Number(match?.[2] || 0) * 60 + Number(match?.[3] || 0);
}

function displayDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// 자막 크롤링: YouTube Data API는 임의 영상의 자막 원문을 제공하지 않으므로
// 시청 페이지의 ytInitialPlayerResponse에서 captionTracks를 추출해 가져온다.
const crawlHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  Cookie: 'CONSENT=YES+1; SOCS=CAI',
};

// startIndex의 '{'부터 문자열/이스케이프를 고려해 중괄호 균형이 맞는 JSON 조각을 잘라낸다.
function extractJsonObject(source: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  return null;
}

// 게시자가 올린 수동 자막 우선, 없으면 자동 생성(ASR) 자막. 한국어 트랙 우선.
function pickCaptionTrack(tracks: any[]) {
  const korean = (list: any[]) => list.find((track) => String(track.languageCode || '').startsWith('ko'));
  const manual = tracks.filter((track) => track.kind !== 'asr');
  const auto = tracks.filter((track) => track.kind === 'asr');
  return korean(manual) || manual[0] || korean(auto) || auto[0] || null;
}

// 1차: 시청 페이지 크롤링, 2차: Innertube player API(ANDROID 클라이언트) 폴백.
// 각 실패 지점을 콘솔에 남겨 Edge Function 로그에서 원인을 추적할 수 있게 한다.
async function fetchCaptionTracks(videoId: string): Promise<any[]> {
  try {
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, { headers: crawlHeaders });
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      const marker = html.indexOf('ytInitialPlayerResponse');
      const braceStart = marker === -1 ? -1 : html.indexOf('{', marker);
      const json = braceStart === -1 ? null : extractJsonObject(html, braceStart);
      const watchPlayer = json ? JSON.parse(json) : null;
      const tracks = watchPlayer?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length) return tracks;
      // playability가 LOGIN_REQUIRED면 유튜브가 서버 IP를 봇으로 차단한 것
      console.log(`[transcript] ${videoId} watch page: no caption tracks (playability: ${watchPlayer?.playabilityStatus?.status || 'unknown'})`);
    } else {
      console.log(`[transcript] ${videoId} watch page: HTTP ${pageResponse.status}`);
    }
  } catch (error) {
    console.log(`[transcript] ${videoId} watch page error: ${error instanceof Error ? error.message : String(error)}`);
  }
  // 유튜브 안드로이드 앱에 내장된 공개 innertube 키 (비밀 아님, 앱 배포본에 포함된 값)
  const androidKey = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
  const androidVersion = '19.29.37';
  try {
    const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${androidKey}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `com.google.android.youtube/${androidVersion} (Linux; U; Android 14) gzip`,
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': androidVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID', clientVersion: androidVersion,
            androidSdkVersion: 34, osName: 'Android', osVersion: '14', hl: 'ko', gl: 'KR',
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    if (!playerResponse.ok) {
      console.log(`[transcript] ${videoId} innertube: HTTP ${playerResponse.status}`);
      return [];
    }
    const payload = await playerResponse.json();
    const tracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length) return tracks;
    console.log(`[transcript] ${videoId} innertube: no caption tracks (playability: ${payload?.playabilityStatus?.status || 'unknown'})`);
  } catch (error) {
    console.log(`[transcript] ${videoId} innertube error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return [];
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  const tracks = await fetchCaptionTracks(videoId);
  const track = pickCaptionTrack(tracks);
  if (!track?.baseUrl) return null;
  try {
    const captionUrl = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    const captionResponse = await fetch(captionUrl, { headers: crawlHeaders });
    if (!captionResponse.ok) {
      console.log(`[transcript] ${videoId} timedtext: HTTP ${captionResponse.status}`);
      return null;
    }
    const payload = await captionResponse.json();
    const text = (payload.events || [])
      .map((event: any) => (event.segs || []).map((seg: any) => seg.utf8 || '').join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) console.log(`[transcript] ${videoId} timedtext: empty caption body`);
    // Excel 셀 한도(32,767자)를 넘지 않도록 자른다.
    return text ? text.slice(0, 30000) : null;
  } catch (error) {
    console.log(`[transcript] ${videoId} timedtext error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function youtubeQuotaDate() {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Los_Angeles',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  if (!isAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const body = await request.json().catch(() => ({}));
  const { videoId, transcript: providedTranscript, code, deviceId, action } = body;

  const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = getAdminKey();
  if (!youtubeApiKey || !supabaseUrl || !adminKey) return new Response(JSON.stringify({ error: 'Required server secrets are missing' }), { status: 500, headers: corsHeaders });

  const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false } });

  // 접근 코드 검증(서버 강제). 유효 코드+등록 기기가 아니면 분석/자막 저장을 모두 거부한다.
  const access = await verifyAccessCode(supabase, String(code || '').trim(), String(deviceId || '').trim(), clientIp(request), request.headers.get('user-agent') || '');
  if (!access.ok) return new Response(JSON.stringify({ error: 'ACCESS_DENIED', reason: access.reason }), { status: 403, headers: corsHeaders });
  const accessCode = String(code || '').trim();

  if (action === 'list') {
    const { data, error } = await supabase
      .from('youtube_keyword_master_analysis_results')
      .select('*')
      .eq('access_code', accessCode)
      .order('analyzed_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ analyses: data || [] }), { headers: corsHeaders });
  }

  if (action === 'clear') {
    const { error } = await supabase
      .from('youtube_keyword_master_analysis_results')
      .delete()
      .eq('access_code', accessCode);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (!videoId || typeof videoId !== 'string') return new Response(JSON.stringify({ error: 'videoId is required' }), { status: 400, headers: corsHeaders });

  // 크롬 확장이 사용자 브라우저(일반 IP)에서 추출한 자막을 저장하는 경로.
  // 서버 크롤링은 유튜브의 데이터센터 IP 차단으로 막혀 있어 클라이언트 추출을 허용한다.
  if (typeof providedTranscript === 'string' && providedTranscript.trim()) {
    const cleanTranscript = providedTranscript.replace(/\s+/g, ' ').trim().slice(0, 30000);
    const { data: updated, error: saveError } = await supabase
      .from('youtube_keyword_master_analysis_results')
      .update({ transcript: cleanTranscript })
      .eq('access_code', accessCode)
      .eq('video_id', videoId)
      .select('*')
      .maybeSingle();
    if (saveError) return new Response(JSON.stringify({ error: saveError.message }), { status: 500, headers: corsHeaders });
    if (!updated) return new Response(JSON.stringify({ error: 'Analysis not found for transcript save' }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify({ analysis: updated, saved: true }), { headers: corsHeaders });
  }

  const cacheCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await supabase
    .from('youtube_keyword_master_analysis_results')
    .select('*')
    .eq('access_code', accessCode)
    .eq('video_id', videoId)
    .gte('analyzed_at', cacheCutoff)
    .maybeSingle();
  if (cached) {
    // 캐시에 자막이 없으면 크롤링만 다시 시도해 채운다 (YouTube API 쿼터 미사용).
    if (!cached.transcript) {
      const backfilled = await fetchTranscript(videoId);
      if (backfilled) {
        cached.transcript = backfilled;
        await supabase.from('youtube_keyword_master_analysis_results').update({ transcript: backfilled }).eq('access_code', accessCode).eq('video_id', videoId);
      }
    }
    return new Response(JSON.stringify({ analysis: cached, cached: true }), { headers: corsHeaders });
  }

  const { data: quotaReserved, error: quotaError } = await supabase.rpc('youtube_keyword_master_reserve_api_quota', {
    p_usage_date: youtubeQuotaDate(), p_units: 3, p_search_calls: 0,
  });
  if (quotaError) return new Response(JSON.stringify({ error: quotaError.message }), { status: 500, headers: corsHeaders });
  if (!quotaReserved) return new Response(JSON.stringify({ error: 'Daily YouTube API safety limit reached' }), { status: 429, headers: corsHeaders });

  const videoParams = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: videoId, key: youtubeApiKey });
  const videoResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`);
  const videoPayload = await videoResponse.json();
  const video = videoPayload.items?.[0];
  if (!videoResponse.ok || !video) return new Response(JSON.stringify({ error: videoPayload?.error?.message || 'Video not found' }), { status: 404, headers: corsHeaders });

  const commentParams = new URLSearchParams({ part: 'snippet', videoId, order: 'relevance', maxResults: '50', textFormat: 'plainText', key: youtubeApiKey });
  const commentResponse = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${commentParams}`);
  const commentPayload = await commentResponse.json();
  const comments = commentResponse.ok
    ? (commentPayload.items || []).map((item: any) => {
        const comment = item.snippet?.topLevelComment?.snippet || {};
        return { author: comment.authorDisplayName || '', text: comment.textDisplay || '', likes: Number(comment.likeCount || 0) };
      }).sort((a: any, b: any) => b.likes - a.likes).slice(0, 3)
    : [];

  // 채널 프로필 이미지 (channels.list = 1유닛)
  let channelThumbnail = '';
  const channelId = video.snippet?.channelId || '';
  if (channelId) {
    const channelParams = new URLSearchParams({ part: 'snippet', id: channelId, key: youtubeApiKey });
    const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`);
    if (channelResponse.ok) {
      const channelPayload = await channelResponse.json();
      const channelThumbs = channelPayload.items?.[0]?.snippet?.thumbnails;
      channelThumbnail = channelThumbs?.medium?.url || channelThumbs?.default?.url || '';
    }
  }

  // 자막은 YouTube API 쿼터를 사용하지 않는다. 실패 시 null → '스크립트 없음' 표시.
  const transcript = await fetchTranscript(videoId);

  const descriptionTags = [...String(video.snippet?.description || '').matchAll(/#[\p{L}\p{N}_-]+/gu)].map((match) => match[0]);
  const hashtags = [...new Set([...(video.snippet?.tags || []).map((tag: string) => `#${tag.replace(/^#/, '')}`), ...descriptionTags])].slice(0, 30);
  const durationSeconds = parseDuration(video.contentDetails?.duration || 'PT0S');
  const result = {
    access_code: accessCode,
    video_id: videoId,
    channel_title: video.snippet?.channelTitle || '',
    category_key: YT_CATEGORY_TO_KEY[String(video.snippet?.categoryId || '')] || '',
    title: video.snippet?.title || '',
    youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail_url: video.snippet?.thumbnails?.maxres?.url || video.snippet?.thumbnails?.standard?.url || video.snippet?.thumbnails?.high?.url || '',
    channel_thumbnail_url: channelThumbnail,
    duration_display: displayDuration(durationSeconds),
    duration_seconds: durationSeconds,
    published_at: video.snippet?.publishedAt,
    view_count: Number(video.statistics?.viewCount || 0),
    like_count: Number(video.statistics?.likeCount || 0),
    comment_count: Number(video.statistics?.commentCount || 0),
    hashtags,
    top_comments: comments,
    transcript,
    analyzed_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertError } = await supabase
    .from('youtube_keyword_master_analysis_results')
    .insert(result)
    .select('*')
    .maybeSingle();
  if (insertError && String(insertError.code) !== '23505') {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: corsHeaders });
  }
  if (!insertError) return new Response(JSON.stringify({ analysis: inserted || result }), { headers: corsHeaders });

  const { data: updated, error: updateError } = await supabase
    .from('youtube_keyword_master_analysis_results')
    .update(result)
    .eq('access_code', accessCode)
    .eq('video_id', videoId)
    .select('*')
    .maybeSingle();
  if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: corsHeaders });
  return new Response(JSON.stringify({ analysis: updated || result }), { headers: corsHeaders });
});
