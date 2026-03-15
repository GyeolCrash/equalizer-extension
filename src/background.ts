/**
 * Background Service Worker (Manifest V3)
 * Chrome Extension API 호출 및 오디오 스트림 캡처
 * 
 * 역할:
 * - 현재 활성 탭의 오디오 스트림을 캡처하는 진입점
 * - 캡처된 MediaStream을 Offscreen Document로 메시지 패싱
 * - Chrome 권한(tabCapture) 기반 오디오 렉더러 접근
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 그래프 기반 동적 이퀄라이저 확장 프로그램이 설치되었습니다.');
});

// Offscreen 준비 완료 플래그
let offscreenReady = false;

/**
 * 현재 활성 탭 ID 캐싱 (팝업과 캡처 상태 동기화용)
 */
let currentActiveTabId: number | null = null;
let isCapturing = false;

/**
 * Popup 및 Offscreen으로부터 메시지 수신
 * 
 * START_CAPTURE: 팝업이 열렸을 때 오디오 캡처 시작
 * STOP_CAPTURE: 팝업이 닫혔을 때 오디오 캡처 중지
 * OFFSCREEN_READY: Offscreen이 준비 완료되었을 때
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OFFSCREEN_READY') {
    console.log('[Background] Offscreen document 준비 완료 신호 수신');
    offscreenReady = true;
    sendResponse({ success: true });
    return false; // 동기 응답 완료
  } else if (request.type === 'START_CAPTURE') {
    console.log('[Background] 팝업 열림 → 오디오 캡처 시작 신호 수신');
    isCapturing = true;
    
    // 응답 먼저 전송
    sendResponse({ success: true });
    
    // 비동기 작업은 이후에 시작 (sendResponse 후)
    captureActiveTabAudio().catch((error) => {
      console.error('[Background] captureActiveTabAudio 오류:', error);
    });
    
    return false; // 동기 응답 이미 완료
  } else if (request.type === 'STOP_CAPTURE') {
    console.log('[Background] 팝업 닫힘 → 오디오 캡처 중지 신호 수신');
    isCapturing = false;
    // Offscreen에서 미디어 스트림 정리
    chrome.runtime.sendMessage({
      type: 'CLEANUP_MEDIA_STREAM'
    }).catch(() => {
      // Offscreen이 없거나 응답 없음 (정상)
    });
    sendResponse({ success: true });
    return false; // 동기 응답 완료
  }
  return true; // 기본값: 비동기 응답 대기
});

/**
 * 확장 프로그램 시작 시 자동으로 활성 탭의 오디오 캡처
 * chrome.tabs.onActivated: 탭이 활성화될 때 발생
 * chrome.tabs.onUpdated: 탭이 업데이트될 때 발생
 */
async function captureActiveTabAudio() {
  try {
    // 현재 활성 탭 획득
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      console.log('[Background] 활성 탭을 찾을 수 없습니다.');
      return;
    }

    const tabId = tabs[0].id;

    // Offscreen Document 동적 생성 (또는 이미 존재)
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Web Audio API와 MediaStream 처리 필요'
      });
      console.log('[Background] Offscreen document 생성 완료');
    } catch (error) {
      console.log('[Background] Offscreen document 이미 존재:', (error as Error).message);
    }

    // Offscreen 준비 완료를 기다림 (최대 5초)
    let waitCount = 0;
    while (!offscreenReady && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }

    if (!offscreenReady) {
      console.warn('[Background] Offscreen 준비 타임아웃, 계속 진행합니다...');
    }

    // chrome.tabCapture.getMediaStreamId API 사용 가능성 확인 (Manifest V3 호환)
    if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
      console.error('[Background] chrome.tabCapture.getMediaStreamId API를 사용할 수 없습니다.');
      console.log('[Background] 사용 가능한 chrome API:', Object.keys(chrome));
      return;
    }

    /**
     * Manifest V3 호환 오디오 캡처: chrome.tabCapture.getMediaStreamId
     * 
     * chrome.tabCapture.capture는 DOM 객체 반환 → Service Worker에서 사용 불가
     * 해결: getMediaStreamId → streamId (문자열) 획득 → Offscreen에서 getUserMedia
     * 
     * 흐름:
     * 1. Background: getMediaStreamId(tabId) → streamId (문자열)
     * 2. Background: Offscreen에 streamId 전송
     * 3. Offscreen: getUserMedia(chromeMediaSourceId: streamId) → MediaStream
     * 4. Offscreen: Web Audio API 처리
     */
    console.log('[Background] chrome.tabCapture.getMediaStreamId 호출 중... tabId:', tabId);
    
    chrome.tabCapture.getMediaStreamId(
      { consumerTabId: tabId },
      (streamId) => {
        // 콜백이 호출되었음을 확인
        console.log('[Background] getMediaStreamId 콜백 실행됨');
        
        if (chrome.runtime.lastError) {
          console.error('[Background] getMediaStreamId 실패 - 에러:', chrome.runtime.lastError.message);
          console.error('[Background] 전체 에러 객체:', chrome.runtime.lastError);
          return;
        }

        if (!streamId) {
          console.error('[Background] streamId가 비었습니다. streamId:', streamId);
          return;
        }

        console.log('[Background] ✓ streamId 획득 성공:', streamId.substring(0, 20) + '...');

        /**
         * Offscreen Document에 streamId를 SETUP_MEDIA_STREAM 메시지로 전달
         * Offscreen에서 navigator.mediaDevices.getUserMedia() 호출하여 실제 스트림 획득
         */
        chrome.runtime.sendMessage({
          type: 'SETUP_MEDIA_STREAM',
          streamId: streamId,
          tabId: tabId
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Background] Offscreen 설정 메시지 응답 (타임아웃 정상):', chrome.runtime.lastError.message);
          } else if (response?.success) {
            console.log('[Background] ✓ Offscreen 미디어 스트림 설정 완료');
          }
        });
      }
    );
  } catch (error) {
    console.error('[Background] 오디오 캡처 중 오류:', error);
  }
}

export {};
