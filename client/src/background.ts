let isCapturing = false;
let isCaptureInitializing = false;
let offscreenPort: chrome.runtime.Port | null = null;
const uiPorts: Set<chrome.runtime.Port> = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-port') {
    offscreenPort = port;
    offscreenPort.onMessage.addListener((msg) => {
      if (msg.type === 'STREAM_ENDED') {
        stopAudioCapture();
      } else {
        for (const uiPort of uiPorts) {
          uiPort.postMessage(msg);
        }
      }
    });
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
  } else if (port.name === 'popup-port') {
    uiPorts.add(port);

    port.onDisconnect.addListener(() => {
      uiPorts.delete(port);
    });

    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'START_CAPTURE') {
        startAudioCapture();
      } else if (msg.type === 'STOP_CAPTURE') {
        stopAudioCapture();
      } else if (msg.type === 'GET_STATUS') {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (contexts.length > 0) {
          isCapturing = true;
          if (!offscreenPort) {
            chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' });
            for (let i = 0; i < 10; i++) {
              if (offscreenPort) break;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
        } else {
          isCapturing = false;
        }

        if (offscreenPort) {
          offscreenPort.postMessage(msg);
        } else {
          port.postMessage({ type: 'SYNC_STATUS', data: { filters: [], masterGain: 1.0 } });
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
      url: chrome.runtime.getURL('src/offscreen.html'),
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: '탭 오디오 캡처 및 이퀄라이저 파이프라인 유지'
    }).catch(err => {
      console.error('[Background] Offscreen 생성 실패:', err);
      chrome.runtime.onMessage.removeListener(readyListener);
      resolve(false);
    });
  });
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
  isCapturing = false;
  offscreenPort = null;
}

async function startAudioCapture() {
  if (isCapturing || isCaptureInitializing) return;
  isCaptureInitializing = true;

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
    }
  } catch (error) {
    console.error('[Background] 캡처 프로세스 오류:', error);
  } finally {
    isCaptureInitializing = false;
  }
}

async function stopAudioCapture() {
  isCapturing = false;
  isCaptureInitializing = false;
  if (offscreenPort) {
    offscreenPort.postMessage({ type: 'CLEANUP_MEDIA_STREAM' });
  }
  await closeOffscreenDocument();
}

// Receives magic link tokens from the auth-callback content script and stores them for the popup to pick up.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'MAGIC_LINK_CALLBACK' && msg.payload?.access_token) {
    chrome.storage.local.set({ pending_auth: msg.payload });
  }
});

export { };