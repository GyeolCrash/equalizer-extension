let isCapturing = false;
let offscreenPort: chrome.runtime.Port | null = null;
let popupPort: chrome.runtime.Port | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-port') {
    offscreenPort = port;
    
    // 오프스크린에서 전송된 상태 동기화 메시지를 팝업으로 중계
    offscreenPort.onMessage.addListener((msg) => {
      if (popupPort) popupPort.postMessage(msg);
    });
    
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
  } else if (port.name === 'popup-port') {
    popupPort = port;
    popupPort.onDisconnect.addListener(() => {
      popupPort = null;
    });
    
    popupPort.onMessage.addListener((msg) => {
      if (msg.type === 'START_CAPTURE') {
        startAudioCapture();
      } else if (msg.type === 'STOP_CAPTURE') {
        stopAudioCapture();
      } else if (msg.type === 'GET_STATUS') {
        // 팝업 연결 시 현재 캡처 상태를 먼저 동기화
        popupPort?.postMessage({ type: 'CAPTURE_STATUS', capturing: isCapturing });
        
        if (offscreenPort) {
          offscreenPort.postMessage(msg);
        } else {
          // 오프스크린이 없는 경우 빈 초기 상태 전송
          popupPort?.postMessage({ type: 'SYNC_STATUS', data: { filters: [], masterGain: 1.0 } });
        }
      } else if (offscreenPort) {
        offscreenPort.postMessage(msg);
      }
    });
  }
});

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return true;

  return new Promise<boolean>((resolve) => {
    const readyListener = (msg: any) => {
      if (msg.type === 'OFFSCREEN_READY') {
        chrome.runtime.onMessage.removeListener(readyListener);
        resolve(true);
      }
    };
    chrome.runtime.onMessage.addListener(readyListener);

    chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: '탭 오디오 캡처 및 이퀄라이저 파이프라인 유지'
    }).catch(err => {
      console.error('[Background] Offscreen 생성 실패:', err);
      chrome.runtime.onMessage.removeListener(readyListener);
      resolve(false);
    });
  });
}

async function startAudioCapture() {
  if (isCapturing) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error("활성 탭 획득 실패");

    const isOffscreenReady = await ensureOffscreenDocument();
    if (!isOffscreenReady) throw new Error("Offscreen 초기화 타임아웃");

    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!id) reject(new Error("스트림 ID 획득 실패"));
        else resolve(id);
      });
    });

    if (offscreenPort) {
      offscreenPort.postMessage({ type: 'SETUP_MEDIA_STREAM', streamId });
      isCapturing = true;
      if (popupPort) popupPort.postMessage({ type: 'CAPTURE_STATUS', capturing: true });
    }
  } catch (error) {
    console.error('[Background] 캡처 프로세스 오류:', error);
  }
}

function stopAudioCapture() {
  isCapturing = false;
  if (offscreenPort) {
    offscreenPort.postMessage({ type: 'CLEANUP_MEDIA_STREAM' });
  }
  if (popupPort) {
    popupPort.postMessage({ type: 'CAPTURE_STATUS', capturing: false });
  }
}

export {};