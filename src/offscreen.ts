/**
 * Offscreen Document (Manifest V3)
 * Web Audio API 오디오 컨텍스트 관리 및 필터 체인 구성
 *
 * [FIX LOG]
 * 1. 커스텀 AudioNode interface 제거 (Web Audio API 빌트인 AudioNode 덮어씌움 방지)
 * 2. cleanup() 메서드 추가 (MediaStream track 정리 + 노드 연결 해제)
 * 3. CLEANUP_MEDIA_STREAM 핸들러에서 실제 정리 로직 실행
 * 4. 재캡처 시 기존 스트림 정리 후 새 스트림 연결
 */

interface FilterConfig {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;  // ★ 추가: 정리용 MediaStream 참조
  private analyserNode: AnalyserNode | null = null;
  private filters: Map<number, BiquadFilterNode> = new Map();
  private filterNodeIds: number[] = [];
  private gainNode: GainNode | null = null;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('[AudioContext] 초기화 성공 - 상태:', this.audioContext.state);
    } catch (error) {
      console.error('[AudioContext] 초기화 실패:', error);
    }
  }

  /**
   * streamId로부터 MediaStream을 획득하고 Web Audio 그래프에 연결
   */
  async setupMediaStreamFromId(streamId: string): Promise<void> {
    if (!streamId || typeof streamId !== 'string') {
      throw new Error('streamId는 유효한 문자열이어야 합니다.');
    }

    console.log('[setupMediaStreamFromId] getUserMedia 호출 시작...');

    // ★ 기존 스트림이 있으면 먼저 정리
    if (this.mediaStream) {
      console.log('[setupMediaStreamFromId] 기존 스트림 정리 중...');
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        // @ts-ignore - Chrome 확장 전용: 탭 오디오 캡처
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      } as any,
      video: false
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[setupMediaStreamFromId] ✓ getUserMedia 성공 - tracks:', stream.getTracks().length);
      this.mediaStream = stream;  // ★ 참조 저장
      this.connectMediaStream(stream);
    } catch (error) {
      const err = error as DOMException;
      console.error('[setupMediaStreamFromId] getUserMedia 실패:', err.name, err.message);

      if (err.name === 'AbortError') {
        console.error('[진단] AbortError - 가능한 원인:');
        console.error('  1. streamId가 만료됨 (background에서 offscreen까지 전달이 너무 늦음)');
        console.error('  2. consumerTabId가 잘못 지정됨 (background.ts에서 targetTabId로 수정 필요)');
        console.error('  3. 탭이 chrome:// 등 캡처 불가 페이지');
        console.error('  4. 다른 캡처가 이미 진행 중');
      }

      throw error;
    }
  }

  /**
   * MediaStream을 Web Audio API 오디오 그래프에 연결
   */
  connectMediaStream(stream: MediaStream) {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    try {
      // ★ 기존 소스 노드 정리
      if (this.mediaStreamSource) {
        try { this.mediaStreamSource.disconnect(); } catch (_) {}
        this.mediaStreamSource = null;
      }

      this.mediaStreamSource = this.audioContext!.createMediaStreamSource(stream);

      // AudioContext 재개 (suspended 상태일 수 있음)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch((err) => {
          console.warn('[AudioContext] resume 실패:', err);
        });
      }

      this.setupAudioChain();
      console.log('✓ MediaStream 연결 성공 - 오디오 파이프라인 활성화');
    } catch (error) {
      console.error('[MediaStream] 연결 실패:', error);
    }
  }

  /**
   * Web Audio API 오디오 노드 그래프 구성
   * 
   * 신호 흐름:
   * MediaStreamSource → [BiquadFilter × N] → GainNode → AnalyserNode → destination
   */
  private setupAudioChain() {
    if (!this.mediaStreamSource || !this.audioContext) {
      console.error('[setupAudioChain] mediaStreamSource 또는 audioContext가 null입니다.');
      return;
    }

    // Step 1: 기존 연결 해제
    try {
      this.mediaStreamSource.disconnect();
      if (this.gainNode) this.gainNode.disconnect();
      if (this.analyserNode) this.analyserNode.disconnect();
      for (const filter of this.filters.values()) {
        filter.disconnect();
      }
    } catch (error) {
      // disconnect 시 이미 연결이 없으면 에러 → 무시
    }

    // Step 2: 노드 생성
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // Step 3: 체인 연결
    // ★ FIX: AudioNode 타입을 빌트인 Web Audio API의 AudioNode로 사용
    let currentNode: globalThis.AudioNode = this.mediaStreamSource;

    for (const nodeId of this.filterNodeIds) {
      const filter = this.filters.get(nodeId);
      if (filter) {
        currentNode.connect(filter);
        currentNode = filter;
      }
    }

    currentNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    console.log(`✓ 오디오 체인 구성: Source → [${this.filters.size} 필터] → Gain → Analyser → Destination`);
  }

  /**
   * BiquadFilterNode 생성
   */
  private createBiquadFilter(frequency: number): BiquadFilterNode {
    if (!this.audioContext) {
      throw new Error('AudioContext가 초기화되지 않음');
    }

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1.0;
    filter.gain.value = 0;
    return filter;
  }

  addFilter(nodeId: number, frequency: number): boolean {
    if (this.filters.has(nodeId)) {
      console.error(`필터 ${nodeId}은 이미 존재합니다.`);
      return false;
    }

    if (!this.audioContext) {
      console.error('AudioContext가 초기화되지 않음');
      return false;
    }

    const filter = this.createBiquadFilter(frequency);
    this.filters.set(nodeId, filter);
    this.filterNodeIds.push(nodeId);

    console.log(`필터 ${nodeId} 추가 완료 (주파수: ${frequency}Hz)`);

    // 스트림이 연결되어 있으면 체인 재구성
    if (this.mediaStreamSource) {
      this.setupAudioChain();
    }

    return true;
  }

  removeFilter(nodeId: number): boolean {
    if (!this.filters.has(nodeId)) {
      console.error(`필터 ${nodeId}을 찾을 수 없습니다.`);
      return false;
    }

    const filter = this.filters.get(nodeId);
    if (filter) {
      try { filter.disconnect(); } catch (_) {}
    }

    this.filters.delete(nodeId);
    this.filterNodeIds = this.filterNodeIds.filter(id => id !== nodeId);

    console.log(`필터 ${nodeId} 제거 완료`);

    if (this.mediaStreamSource) {
      this.setupAudioChain();
    }

    return true;
  }

  updateFilter(nodeId: number, config: Partial<FilterConfig>) {
    const filter = this.filters.get(nodeId);
    if (!filter) {
      console.error(`필터 ${nodeId}을 찾을 수 없습니다.`);
      return;
    }

    if (config.type) filter.type = config.type;
    if (config.frequency !== undefined) filter.frequency.value = config.frequency;
    if (config.Q !== undefined) filter.Q.value = config.Q;
    if (config.gain !== undefined) filter.gain.value = config.gain;

    console.log(`필터 ${nodeId} 업데이트:`, config);
  }

  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) return null;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }

  setMasterGain(gain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2, gain));
    }
  }

  getStatus() {
    const filterArray: any[] = [];
    for (const nodeId of this.filterNodeIds) {
      const filter = this.filters.get(nodeId);
      if (filter) {
        filterArray.push({
          nodeId,
          type: filter.type,
          frequency: filter.frequency.value,
          Q: filter.Q.value,
          gain: filter.gain.value
        });
      }
    }

    return {
      isRunning: this.audioContext?.state === 'running',
      filters: filterArray
    };
  }

  /**
   * ★ 추가: 전체 리소스 정리
   * MediaStream track 중지, 노드 연결 해제, AudioContext 리셋
   */
  cleanup() {
    console.log('[AudioProcessor] cleanup 시작...');

    // MediaStream tracks 중지
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log(`[cleanup] Track "${track.label}" stopped`);
      });
      this.mediaStream = null;
    }

    // 모든 노드 연결 해제
    try {
      if (this.mediaStreamSource) {
        this.mediaStreamSource.disconnect();
        this.mediaStreamSource = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      if (this.analyserNode) {
        this.analyserNode.disconnect();
        this.analyserNode = null;
      }
      for (const filter of this.filters.values()) {
        filter.disconnect();
      }
    } catch (error) {
      console.warn('[cleanup] 노드 해제 중 경고:', error);
    }

    // 필터 맵은 유지 (재캡처 시 필요할 수 있음)
    console.log('[AudioProcessor] ✓ cleanup 완료');
  }
}

// 전역 AudioProcessor 인스턴스
const audioProcessor = new AudioProcessor();

// Background에 준비 완료 신호 전송
chrome.runtime.sendMessage({
  type: 'OFFSCREEN_READY',
  message: 'Offscreen document와 AudioProcessor 초기화 완료'
}).catch(error => {
  console.log('[Offscreen] Background 메시지 전송 실패 (정상):', error);
});

/**
 * 메시지 리스너
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  try {
    switch (request.type) {
      case 'SETUP_MEDIA_STREAM':
        if (typeof request.streamId === 'string') {
          console.log('[Offscreen] SETUP_MEDIA_STREAM 수신 - getUserMedia 호출');
          audioProcessor.setupMediaStreamFromId(request.streamId)
            .then(() => {
              sendResponse({ success: true, message: '미디어 스트림 설정 완료' });
            })
            .catch((error: Error) => {
              console.error('[Offscreen] 스트림 설정 실패:', error.message);
              sendResponse({ success: false, error: error.message });
            });
          return true; // 비동기 응답
        } else {
          sendResponse({ success: false, error: 'streamId는 문자열이어야 합니다.' });
        }
        break;

      case 'START_CAPTURE':
      case 'STOP_CAPTURE':
        // Background용 메시지 → Offscreen에서는 무시
        return false;

      case 'CLEANUP_MEDIA_STREAM':
        // ★ FIX: 실제 정리 로직 실행
        audioProcessor.cleanup();
        sendResponse({ success: true, message: '미디어 스트림 정리 완료' });
        break;

      case 'ADD_FILTER':
        const addSuccess = audioProcessor.addFilter(request.nodeId, request.frequency);
        sendResponse({ success: addSuccess });
        break;

      case 'UPDATE_FILTER':
        audioProcessor.updateFilter(request.nodeId, request.config);
        sendResponse({ success: true });
        break;

      case 'REMOVE_FILTER':
        const removeSuccess = audioProcessor.removeFilter(request.nodeId);
        sendResponse({ success: removeSuccess });
        break;

      case 'GET_FREQUENCY_DATA':
        const frequencyData = audioProcessor.getFrequencyData();
        sendResponse({ frequencyData: frequencyData ? Array.from(frequencyData) : null });
        break;

      case 'SET_MASTER_GAIN':
        audioProcessor.setMasterGain(request.gain);
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse(audioProcessor.getStatus());
        break;

      default:
        // 알 수 없는 메시지는 무시
        return false;
    }
  } catch (error) {
    console.error('[Offscreen] 메시지 처리 중 예외:', error);
    try {
      sendResponse({ success: false, error: '메시지 처리 중 오류 발생' });
    } catch (_) {}
  }

  return true;
});

export {};
