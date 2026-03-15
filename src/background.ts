/**
 * Background Service Worker (Manifest V3)
 * 
 * [FIX LOG]
 * 1. CRITICAL: consumerTabId → targetTabId (offscreen은 탭이 아니므로 consumerTabId 지정 시 AbortError)
 * 2. CRITICAL: getMediaStreamId를 offscreen 생성 전에 호출 (user gesture 만료 방지)
 * 3. chrome.runtime.getContexts()로 offscreen 존재 확인 (try-catch 대체)
 * 4. 미처리 메시지에 return false (offscreen 응답 방해 방지)
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 그래프 기반 동적 이퀄라이저 확장 프로그램이 설치되었습니다.');
});

let offscreenReady = false;
let isCapturing = false;

/**
 * Offscreen Document 존재 여부 확인 및 생성
 * Chrome 116+: chrome.runtime.getContexts() 사용
 */
async function ensureOffscreenDocument(): Promise<void> {
  // Chrome 116+: getContexts로 offscreen 존재 확인
  const contexts = await (chrome.runtime as any).getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (contexts && contexts.length > 0) {
    console.log('[Background] Offscreen document 이미 존재');
    return;
  }

  // 존재하지 않으면 새로 생성
  await chrome.offscreen.createDocument({
    url: 'src/offscreen.html',
    reasons: [
      'USER_MEDIA' as chrome.offscreen.Reason,
      'AUDIO_PLAYBACK' as chrome.offscreen.Reason
    ],
    justification: 'Tab audio capture via getUserMedia + Web Audio API processing'
  });

  console.log('[Background] Offscreen document 생성 완료');

  // Offscreen 준비 완료 대기 (최대 3초)
  let waitCount = 0;
  while (!offscreenReady && waitCount < 30) {
    await new Promise(resolve => setTimeout(resolve, 100));
    waitCount++;
  }

  if (!offscreenReady) {
    console.warn('[Background] Offscreen 준비 대기 타임아웃, 계속 진행');
  }
}

/**
 * 현재 활성 탭의 오디오를 캡처하는 메인 함수
 * 
 * ★ 핵심 수정: getMediaStreamId를 가장 먼저 호출
 *   - user gesture context는 1~2초 내에 만료됨
 *   - offscreen 생성 등 비동기 작업 전에 streamId를 확보해야 함
 * 
 * ★ 핵심 수정: targetTabId 사용 (consumerTabId 아님)
 *   - consumerTabId = "이 streamId를 소비할 탭" → offscreen은 탭이 아니므로 불일치 → AbortError
 *   - targetTabId = "캡처할 대상 탭" → 올바른 사용법
 *   - consumerTabId를 생략하면 확장 프로그램 자체(offscreen 포함)가 소비 가능
 */
async function captureActiveTabAudio() {
  if (isCapturing) {
    console.log('[Background] 이미 캡처 중, 스킵');
    return;
  }

  try {
    // Step 1: 활성 탭 확인
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      console.error('[Background] 활성 탭을 찾을 수 없습니다.');
      return;
    }

    const tab = tabs[0];
    const tabId = tab.id!;

    // 캡처 불가능한 페이지 필터링
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      console.error('[Background] chrome:// 또는 extension 페이지는 캡처할 수 없습니다:', tab.url);
      return;
    }

    // Step 2: ★ getMediaStreamId를 가장 먼저 호출 (user gesture 유효 시간 내)
    console.log('[Background] getMediaStreamId 호출 중... tabId:', tabId);

    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },  // ★ FIX: consumerTabId가 아닌 targetTabId
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'getMediaStreamId failed'));
            return;
          }
          if (!id) {
            reject(new Error('streamId가 비어있습니다'));
            return;
          }
          resolve(id);
        }
      );
    });

    console.log('[Background] ✓ streamId 획득 성공:', streamId.substring(0, 20) + '...');

    // Step 3: Offscreen Document 생성 (streamId는 이미 확보됨, 시간 제한 없음)
    await ensureOffscreenDocument();

    // Step 4: streamId를 Offscreen으로 전달
    console.log('[Background] Offscreen에 streamId 전달 중...');

    const response = await chrome.runtime.sendMessage({
      type: 'SETUP_MEDIA_STREAM',
      streamId: streamId,
      tabId: tabId
    });

    if (response?.success) {
      isCapturing = true;
      console.log('[Background] ✓ 오디오 캡처 파이프라인 구성 완료');
    } else {
      console.error('[Background] Offscreen 스트림 설정 실패:', response?.error || response);
    }

  } catch (error) {
    console.error('[Background] captureActiveTabAudio 오류:', error);
    isCapturing = false;
  }
}

/**
 * 메시지 리스너
 * 
 * ★ 수정: 처리하지 않는 메시지는 return false
 *   - return true는 "비동기 응답 예정"을 의미
 *   - 미처리 메시지에 return true하면 offscreen의 sendResponse가 도달하지 않음
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.type) {
    case 'OFFSCREEN_READY':
      console.log('[Background] Offscreen document 준비 완료 신호 수신');
      offscreenReady = true;
      sendResponse({ success: true });
      return false;

    case 'START_CAPTURE':
      console.log('[Background] 오디오 캡처 시작 신호 수신');
      sendResponse({ success: true });
      captureActiveTabAudio().catch((error) => {
        console.error('[Background] captureActiveTabAudio 오류:', error);
      });
      return false;

    case 'STOP_CAPTURE':
      console.log('[Background] 오디오 캡처 중지 신호 수신');
      isCapturing = false;
      chrome.runtime.sendMessage({ type: 'CLEANUP_MEDIA_STREAM' }).catch(() => {});
      sendResponse({ success: true });
      return false;

    default:
      // ★ FIX: 미처리 메시지는 return false
      // UPDATE_FILTER, GET_FREQUENCY_DATA 등은 offscreen이 처리
      // return true하면 background가 응답 채널을 점유하여 offscreen 응답 차단
      return false;
  }
});

export {};
