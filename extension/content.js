// 사이트(웹 페이지)와 확장 백그라운드 사이의 다리 역할.
// 페이지는 확장에 직접 접근할 수 없으므로 window.postMessage로 신호를 주고받는다.
console.log('[YKM] 자막 도우미 연결됨:', window.location.href);

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'YKM_TRANSCRIPT_REQUEST' || typeof data.videoId !== 'string') return;
  console.log('[YKM] 자막 요청 수신:', data.videoId);
  // 확장이 새로고침되면 기존 페이지의 연결이 끊긴다(고아 스크립트). 페이지 새로고침 필요.
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    console.log('[YKM] 확장 연결이 끊겼습니다. 이 페이지를 새로고침(F5) 해주세요.');
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: 'fetchTranscript', videoId: data.videoId }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[YKM] 백그라운드 오류:', chrome.runtime.lastError.message);
        return;
      }
      console.log('[YKM] 자막 응답:', response && response.transcript ? `${response.transcript.length}자` : '없음');
      if (response && typeof response.transcript === 'string' && response.transcript) {
        window.postMessage(
          { type: 'YKM_TRANSCRIPT_RESULT', videoId: data.videoId, transcript: response.transcript },
          window.location.origin,
        );
      }
    });
  } catch (error) {
    console.log('[YKM] 확장 연결 오류(페이지를 새로고침해 주세요):', error && error.message);
  }
});

// 쇼츠 판별 요청 다리: 페이지가 영상 id 목록을 주면 백그라운드가 /shorts/ URL로 확인해 돌려준다.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'YKM_CHECK_SHORTS_REQUEST' || !Array.isArray(data.videoIds)) return;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
  try {
    chrome.runtime.sendMessage({ type: 'checkShorts', videoIds: data.videoIds }, (response) => {
      if (chrome.runtime.lastError) return;
      window.postMessage(
        { type: 'YKM_CHECK_SHORTS_RESULT', results: (response && response.results) || {} },
        window.location.origin,
      );
    });
  } catch (error) { /* 확장 연결 끊김 등 무시 */ }
});
