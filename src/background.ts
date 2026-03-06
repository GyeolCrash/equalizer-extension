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
  console.log('Pro-Q Equalizer 확장 프로그램이 설치되었습니다.');
});

/**
 * 확장 프로그램 아이콘 클릭 시 오디오 캡처 시작
 * chrome.action.onClicked: 사용자가 도구모음의 확장 프로그램 아이콘을 클릭했을 때 발생
 * 파라미터: tab (TabDef) - 클릭이 발생한 탭의 정보 (id, url, windowId 등)
 */
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    console.error('탭 ID를 획득할 수 없습니다.');
    return;
  }

  /**
   * chrome.tabCapture.capture(constraints, callback)
   * - constraints (CaptureStreamOptions): 캡처 옵션 객체
   *   * audio: boolean - 오디오 스트림 캡처 여부
   *   * video: boolean - 비디오 스트림 캡처 여부
   * - callback (function): (stream: MediaStream | undefined) => void
   *
   * 반환값: MediaStream 객체
   * - 활성 탭의 오디오/비디오 렌더러 출력을 나타내는 스트림
   * - Web Audio API 또는 WebRTC의 입력 소스로 사용 가능
   * - 오류 발생 시 undefined 반환 (chrome.runtime.lastError 확인 필수)
   */
  chrome.tabCapture.capture(
    {
      audio: true,  // 현재 탭의 모든 오디오 출력 캡처
      video: false  // 비디오는 불필요하므로 캡처하지 않음
    },
    (stream) => {
      // chrome.runtime.lastError: 마지막 발생한 Chrome API 오류
      // 권한 부족, 이미 캡처 중인 탭, 시스템 제약 등에서 오류 발생 가능
      if (chrome.runtime.lastError) {
        console.error('탭 캡처 실패:', chrome.runtime.lastError.message);
        return;
      }

      if (!stream) {
        console.error('MediaStream 객체를 획득하지 못했습니다.');
        return;
      }

      console.log('✓ 탭 오디오 캡처 성공 - MediaStream 객체 획득됨');

      /**
       * chrome.runtime.sendMessage(message, responseCallback?)
       * - message (object): Offscreen Document로 전달할 메시지 객체
       * - responseCallback (function, 선택사항): (response: any) => void
       *
       * 메시지 구조:
       * {
       *   type: string - 메시지 타입 식별자 (Offscreen이 type으로 처리 분기)
       *   stream: MediaStream - 캡처된 오디오 스트림
       * }
       *
       * 전달 방식:
       * - Background → Offscreen Document 간 비동기 메시지 전송
       * - Manifest V3에서 DOM이 없는 Service Worker가 DOM이 필요한 
       *   Web Audio API 작업(AudioContext)은 Offscreen에서 수행하도록 위임
       */
      chrome.runtime.sendMessage({
        type: 'CAPTURE_AUDIO_STREAM',
        stream: stream
      });
    }
  );
});

export {};
