// 사용자 브라우저(일반 IP)에서 유튜브 자막을 추출한다.
// 서버(데이터센터 IP)는 유튜브가 봇으로 차단하지만, 여기서는 평범한 사용자 요청이라 통과된다.

// startIndex의 '{'부터 문자열/이스케이프를 고려해 중괄호 균형이 맞는 JSON 조각을 잘라낸다.
function extractJsonObject(source, startIndex) {
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
function pickCaptionTrack(tracks) {
  const korean = (list) => list.find((track) => String(track.languageCode || '').startsWith('ko'));
  const manual = tracks.filter((track) => track.kind !== 'asr');
  const auto = tracks.filter((track) => track.kind === 'asr');
  return korean(manual) || manual[0] || korean(auto) || auto[0] || null;
}

// 유튜브 웹사이트의 "스크립트 보기" 패널이 쓰는 내부 API. 자막 파일(timedtext)과 달리
// 특수 토큰 없이도 자막 전문을 반환한다. key는 유튜브 웹 페이지에 내장된 공개 값(비밀 아님).
async function fetchViaGetTranscript(videoId) {
  // params = protobuf(field1: videoId)의 base64 — videoId는 항상 11자라 헤더가 고정된다.
  const params = btoa('\n\x0b' + videoId);
  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ko', gl: 'KR' } },
      params,
    }),
  });
  console.log('[YKM] get_transcript 상태:', response.status);
  if (!response.ok) return null;
  const payload = await response.json();
  const segments = payload?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer
    ?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments || [];
  const text = segments
    .map((segment) => (segment?.transcriptSegmentRenderer?.snippet?.runs || []).map((run) => run.text || '').join(''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('[YKM] get_transcript 세그먼트:', segments.length, '개 / 텍스트 길이:', text.length);
  return text ? text.slice(0, 30000) : null;
}

// 예비 경로: 시청 페이지에서 자막 트랙 URL을 찾아 자막 파일을 직접 받는다.
// 유튜브가 토큰 없는 요청에 빈 응답을 주는 경우가 많아 2순위로만 시도한다.
async function fetchViaTimedtext(videoId) {
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`);
  console.log('[YKM] 시청 페이지 상태:', pageResponse.status);
  if (!pageResponse.ok) return null;
  const html = await pageResponse.text();
  const marker = html.indexOf('ytInitialPlayerResponse');
  if (marker === -1) {
    console.log('[YKM] 페이지에 플레이어 데이터 없음 (봇 확인 페이지일 수 있음)');
    return null;
  }
  const braceStart = html.indexOf('{', marker);
  if (braceStart === -1) return null;
  const json = extractJsonObject(html, braceStart);
  if (!json) return null;
  const playerResponse = JSON.parse(json);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log('[YKM] 자막 트랙:', tracks.length, '개 / playability:', playerResponse?.playabilityStatus?.status);
  const track = pickCaptionTrack(tracks);
  if (!track || !track.baseUrl) return null;

  const captionUrl = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
  const captionResponse = await fetch(captionUrl);
  const rawBody = await captionResponse.text();
  console.log('[YKM] 자막 파일 상태:', captionResponse.status, '/ 크기:', rawBody.length);
  if (!captionResponse.ok || !rawBody) return null;
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return null; }
  const text = (payload.events || [])
    .map((event) => (event.segs || []).map((seg) => seg.utf8 || '').join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('[YKM] 자막 텍스트 길이:', text.length);
  return text ? text.slice(0, 30000) : null;
}

// 최후이자 가장 확실한 경로: 보이지 않는 백그라운드 탭으로 실제 유튜브 페이지를 열고,
// 그 페이지 컨텍스트(진짜 쿠키·출처)에서 자막을 요청한 뒤 탭을 닫는다.
// 유튜브가 확장/서버발 요청을 막아도 실제 페이지 안의 요청은 통과된다.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(false);
    }, timeoutMs);
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// 유튜브 플레이어가 실제로 재생하며 자막을 로드할 때 만드는 timedtext 요청 URL을 가로챈다.
// 이 URL에는 유튜브가 요구하는 pot 토큰이 포함돼 있어, 그대로 재요청하면 자막 전문을 받을 수 있다.
function captureTimedtextUrl(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { chrome.webRequest.onBeforeRequest.removeListener(listener); } catch { /* noop */ }
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const listener = (details) => {
      if (details.tabId === tabId && /\/api\/timedtext/.test(details.url)) finish(details.url);
    };
    chrome.webRequest.onBeforeRequest.addListener(listener, { urls: ['https://www.youtube.com/api/timedtext*'] });
  });
}

async function fetchViaHiddenTab(videoId) {
  // 완전히 숨긴/최소화한 탭은 크롬이 렌더링을 멈춰 자막이 안 잡히므로, 창 자체는 살리되
  // 화면 밖(음수 좌표) 팝업으로 포커스 없이 열어 보이지 않게 하고, 탭을 음소거한다. 끝나면 닫는다.
  const popup = await chrome.windows.create({
    url: `https://www.youtube.com/watch?v=${videoId}&hl=ko`,
    type: 'popup', width: 640, height: 480, left: -2400, top: -2400, focused: false,
  });
  const tabId = popup.tabs && popup.tabs[0] && popup.tabs[0].id;
  try {
    if (!tabId) return null;
    // 페이지가 자동재생으로 소리를 내기 전에 탭 자체를 음소거한다(video.muted는 아래에서 한 번 더).
    try { await chrome.tabs.update(tabId, { muted: true }); } catch { /* 음소거 실패는 치명적이지 않음 */ }
    const loaded = await waitForTabComplete(tabId, 15000);
    console.log('[YKM] 팝업 창 로드:', loaded ? '완료' : '시간 초과');
    if (!loaded) return null;

    // 플레이어를 음소거 재생하고 CC 자막을 켠다. 동시에 timedtext 요청을 가로챈다.
    const capturePromise = captureTimedtextUrl(tabId, 12000);
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const player = document.getElementById('movie_player');
          const video = document.querySelector('video');
          if (video) { video.muted = true; video.play?.(); }
          // 사용 가능한 첫 자막 트랙을 강제로 켜서 플레이어가 timedtext를 로드하게 한다.
          if (player && player.getOption && player.setOption) {
            const list = player.getOption('captions', 'tracklist') || [];
            if (list.length) player.setOption('captions', 'track', list[0]);
          }
        } catch (error) { /* 플레이어 준비 전일 수 있음 */ }
      },
    });
    const timedtextUrl = await capturePromise;
    console.log('[YKM] timedtext URL 확보:', timedtextUrl ? 'O' : 'X');
    if (!timedtextUrl) return null;

    // 확보한 실제 URL(토큰 포함)을 페이지 컨텍스트에서 json3로 다시 요청한다.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [timedtextUrl],
      func: async (rawUrl) => {
        try {
          const url = rawUrl.includes('fmt=') ? rawUrl : `${rawUrl}&fmt=json3`;
          const response = await fetch(url, { credentials: 'include' });
          const body = await response.text();
          if (!response.ok || !body) return { error: `timedtext ${response.status}/${body.length}b` };
          const payload = JSON.parse(body);
          const text = (payload.events || [])
            .map((event) => (event.segs || []).map((seg) => seg.utf8 || '').join(''))
            .join(' ');
          return { text };
        } catch (error) {
          return { error: String(error && error.message) };
        }
      },
    });
    const outcome = results && results[0] && results[0].result;
    if (!outcome || outcome.error) {
      console.log('[YKM] 팝업 창 추출 실패:', outcome && outcome.error);
      return null;
    }
    const text = String(outcome.text || '').replace(/\s+/g, ' ').trim();
    console.log('[YKM] 팝업 창 자막 길이:', text.length);
    return text ? text.slice(0, 30000) : null;
  } finally {
    try { await chrome.windows.remove(popup.id); } catch { /* 이미 닫힘 */ }
  }
}

// 자막 잡음 제거: 화자표시(>>), [음악]/[박수] 등 대괄호 태그를 걷어낸다.
// 텍스트 오탈자는 AI 재구성 단계에서 문맥으로 교정하므로 여기서는 손대지 않는다.
function cleanTranscript(text) {
  if (!text) return text;
  return text
    .replace(/&gt;&gt;|&gt;|>>|＞＞/g, ' ')
    .replace(/\[[^\]]{1,20}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTranscript(videoId) {
  const fromPanel = await fetchViaGetTranscript(videoId).catch((error) => {
    console.log('[YKM] get_transcript 오류:', error && error.message);
    return null;
  });
  if (fromPanel) return cleanTranscript(fromPanel);
  const fromTimedtext = await fetchViaTimedtext(videoId).catch(() => null);
  if (fromTimedtext) return cleanTranscript(fromTimedtext);
  const fromTab = await fetchViaHiddenTab(videoId).catch((error) => {
    console.log('[YKM] 숨김 탭 오류:', error && error.message);
    return null;
  });
  return fromTab ? cleanTranscript(fromTab) : null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'fetchTranscript' || typeof message.videoId !== 'string') return false;
  console.log('[YKM] 자막 추출 시작:', message.videoId);
  fetchTranscript(message.videoId)
    .then((transcript) => {
      console.log('[YKM] 자막 추출 결과:', transcript ? `${transcript.length}자` : '자막 없음/실패');
      sendResponse({ transcript });
    })
    .catch((error) => {
      console.log('[YKM] 자막 추출 오류:', error && error.message);
      sendResponse({ transcript: null });
    });
  return true; // 비동기 응답을 위해 채널을 유지
});

// /shorts/{id} URL로 실제 쇼츠 여부를 판별한다. 쇼츠면 그대로 200, 아니면 /watch로 리다이렉트된다.
// 사용자 브라우저(일반 IP)에서 실행돼야 유튜브 차단 없이 통과한다.
async function checkIsShort(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, { method: 'GET', redirect: 'manual' });
    if (response.type === 'opaqueredirect') return false; // /watch로 리다이렉트 = 쇼츠 아님
    if (response.status === 200) return true;
    return null; // 판별 불가
  } catch {
    return null;
  }
}

// 여러 영상을 동시 5개까지만 확인한다(과도한 요청·차단 방지). 앞쪽 60개로 제한.
async function checkShorts(videoIds) {
  const results = {};
  const queue = videoIds.filter((id) => typeof id === 'string' && id).slice(0, 60);
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      results[id] = await checkIsShort(id);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'checkShorts' || !Array.isArray(message.videoIds)) return false;
  checkShorts(message.videoIds)
    .then((results) => sendResponse({ results }))
    .catch(() => sendResponse({ results: {} }));
  return true;
});
