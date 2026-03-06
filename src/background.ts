/**
 * Background Service Worker (Manifest V3)
 * Chrome Extension API 호출 및 오디오 컨텍스트 관리
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Pro-Q Equalizer 확장 프로그램이 설치되었습니다.');
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabCapture.capture(
      {
        audio: true,
        video: false
      },
      (stream) => {
        if (chrome.runtime.lastError) {
          console.error('탭 캡처 실패:', chrome.runtime.lastError);
          return;
        }
        console.log('탭 오디오 캡처 성공:', stream);
        // MediaStream 객체를 Offscreen Document로 전달
        chrome.runtime.sendMessage({
          type: 'STREAM_CAPTURED',
          data: stream
        });
      }
    );
  }
});

export {};
