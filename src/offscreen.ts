/**
 * Offscreen Document (Manifest V3)
 * Web Audio API 오디오 컨텍스트 관리 및 필터 체인 구성
 *
 * 역할:
 * - Background Service Worker로부터 수신한 MediaStream을 처리
 * - Web Audio API 오디오 노드 그래프 구성 및 실시간 신호 처리
 * - 파라메트릭 필터 체인(BiquadFilterNode) 관리
 * - Popup UI으로부터의 제어 명령 처리 및 주파수 데이터 전송
 */

interface AudioNode {
  connect(destination: AudioNode | AudioContext): void;
  disconnect(): void;
}

interface FilterNode {
  filter: BiquadFilterNode;
  config: FilterConfig;
}

interface FilterConfig {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

class AudioProcessor {
  // AudioContext: Web Audio API의 최상위 인터페이스
  // - 모든 오디오 노드와 시간 축 관리
  // - 스트림 입력/출력의 중앙 컨텍스트 역할
  private audioContext: AudioContext | null = null;

  // MediaStreamAudioSourceNode: 외부 오디오 스트림(탭, 마이크 등)의 입력 소스
  // - 파라미터: const sourceNode = audioContext.createMediaStreamSource(mediaStream: MediaStream)
  // - 반환값: 스트림의 오디오 샘플을 처리 그래프로 전달하는 노드
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;

  // AnalyserNode: 오디오 신호의 주파수/시간 도메인 데이터 추출
  // - 실시간 스펙트럼 분석 및 시각화에 필요
  // - FFT(Fast Fourier Transform) 기반 주파수 데이터 제공
  private analyserNode: AnalyserNode | null = null;

  // BiquadFilterNode 맵: 동적 노드 ID 기반 필터 관리
  // - key: nodeId (Popup에서의 노드 ID)
  // - value: BiquadFilterNode 인스턴스
  private filters: Map<number, BiquadFilterNode> = new Map();
  private filterNodeIds: number[] = []; // 필터 체인 순서 유지용

  // GainNode: 오디오 신호의 음량 증폭/감쇠
  // - 마스터 게인 컨트롤 및 신호 정규화에 사용
  // - 파라미터 범위: 0.0 (완전 소음) ~ 2.0 (최대 증폭)
  private gainNode: GainNode | null = null;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    try {
      /**
       * Web Audio API의 표준 생성자 사용
       * - AudioContext: 표준 웹 호환 환경
       * - webkitAudioContext: Safari 등 webkit 기반 브라우저 하위호환성
       * 
       * 생성자: new AudioContext() 또는 new webkitAudioContext()
       * 반환: AudioContext 인스턴스
       * 
       * 초기화 후 상태: "suspended" (사용자 상호작용 시 "running"으로 변경)
       * Manifest V3 Offscreen Document 환경에서는 DOM 상호작용 없이
       * 메시지 수신 시점에 자동으로 재개됨
       */
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('[AudioContext] 초기화 성공 - 상태: suspended (메시지 수신 시 재개)');
    } catch (error) {
      console.error('[AudioContext] 초기화 실패:', error);
    }
  }

  /**
   * Manifest V3: streamId로부터 MediaStream을 획득하고 Web Audio 그래프에 연결
   * 
   * 동작:
   * 1. Background로부터 수신한 streamId를 사용
   * 2. navigator.mediaDevices.getUserMedia()를 호출
   *    - constraints.audio.chromeMediaSourceId = streamId 설정
   *    - constraints.audio.mandatory.chromeMediaSource = 'tab' 설정
   * 3. 획득한 MediaStream을 connectMediaStream()에 전달
   * 
   * @param streamId string - chrome.tabCapture.getMediaStreamId()로부터 획득한 토큰
   * @returns Promise<void> - 오디오 스트림 설정 완료 시 resolve
   */
  setupMediaStreamFromId(streamId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!streamId || typeof streamId !== 'string') {
        console.error('[setupMediaStreamFromId] 유효하지 않은 streamId:', streamId);
        reject(new Error('streamId는 유효한 문자열이어야 합니다.'));
        return;
      }

      console.log('[setupMediaStreamFromId] streamId로 getUserMedia 호출:', streamId.substring(0, 10) + '...');
      console.log('[setupMediaStreamFromId] streamId 전체:', streamId);

      // Manifest V3 호환: navigator.mediaDevices.getUserMedia(chromeMediaSourceId)
      // Chrome 확장에서는 이 constraint를 명시적으로 지정해야 합니다
      const constraints = {
        audio: {
          // @ts-ignore - Chrome 확장 전용: 탭 오디오 캡처
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        } as any,
        video: false
      };

      console.log('[setupMediaStreamFromId] getUserMedia constraints:', constraints);

      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          console.log('[setupMediaStreamFromId] ✓ getUserMedia 성공 - MediaStream 획득 완료');
          console.log('[setupMediaStreamFromId] Stream tracks:', stream.getTracks().length);
          // 획득한 스트림을 Web Audio 그래프에 연결
          this.connectMediaStream(stream);
          resolve();
        })
        .catch((error) => {
          console.error('[setupMediaStreamFromId] getUserMedia 실패:', error);
          console.error('[setupMediaStreamFromId] 에러 이름:', error.name);
          console.error('[setupMediaStreamFromId] 에러 메시지:', error.message);
          reject(error);
        });
    });
  }

  /**
   * MediaStream을 Web Audio API 오디오 그래프에 연결
   * 
   * 데이터 흐름:
   * Background (chrome.tabCapture API)
   *    ↓ (MediaStream 객체)
   * Popup (chrome.runtime.sendMessage)
   *    ↓ (CAPTURE_AUDIO_STREAM 메시지)
   * Offscreen (connectMediaStream)
   *    ↓ (createMediaStreamSource)
   * Web Audio Graph (필터 체인 → 스피커 출력)
   * 
   * @param stream MediaStream - Background의 tabCapture API로부터 수신한 탭 오디오 스트림
   */
  connectMediaStream(stream: MediaStream) {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    try {
      /**
       * audioContext.createMediaStreamSource(mediaStream: MediaStream): MediaStreamAudioSourceNode
       * 
       * 역할:
       * - 외부 MediaStream(탭, 마이크 등)을 Web Audio API 그래프에 입력 소스로 등록
       * - 스트림의 오디오 샘플을 실시간으로 처리 그래프로 라우팅
       * 
       * 입력:
       * - mediaStream: Tab Capture API에서 제공한 MediaStream
       *   * stream.getTracks(): AudioTrack[] 포함
       *   * 샘플 레이트: 브라우저 기본 48kHz 또는 44.1kHz
       * 
       * 반환:
       * - MediaStreamAudioSourceNode: 스트림을 필터 체인으로 연결 가능한 오디오 노드
       * - 1개의 출력(mono/stereo) → 여러 노드에 분기 가능 (처리 그래프 구성)
       * 
       * 제약사항:
       * - 창 간 공유 불가 (보안)
       * - 동일 stream으로 2개 이상 source 생성 불가
       * - 스트림 종료 시 노드도 자동 비활성화
       */
      this.mediaStreamSource = this.audioContext!.createMediaStreamSource(stream);

      // AudioContext 상태 재개 (필요시)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch((err) => {
          console.warn('[AudioContext] resume 실패 (사용자 상호작용 필요):', err);
        });
      }

      // 오디오 노드 체인 구성: 소스 → 필터 → 이득 → 분석기 → 스피커
      this.setupAudioChain();

      console.log('✓ MediaStream 연결 성공 - 오디오 파이프라인 활성화');
    } catch (error) {
      console.error('[MediaStream] 연결 실패:', error);
    }
  }

  /**
   * Web Audio API 오디오 노드 그래프 구성
   * 
   * 동적 필터 추가/제거 시 호출되어 전체 체인을 재구성합니다.
   * 
   * 신호 흐름 (직렬 연결):
   * MediaStreamAudioSourceNode
   *    ↓ AudioNode.connect(AudioNode)
   * BiquadFilterNode[0] (동적 필터 1)
   *    ↓
   * BiquadFilterNode[...] (동적 필터 N)
   *    ↓
   * GainNode (마스터 볼륨 제어)
   *    ↓
   * AnalyserNode (스펙트럼 분석: Popup 시각화 데이터 제공)
   *    ↓
   * AudioContext.destination (스피커 출력)
   */
  private setupAudioChain() {
    if (!this.mediaStreamSource || !this.audioContext) {
      console.error('[setupAudioChain] mediaStreamSource 또는 audioContext가 null입니다.');
      return;
    }

    // **Step 1: 기존 연결 모두 해제 (동적 갱신 시 필수)**
    console.log('[setupAudioChain] 기존 노드 연결 해제 시작...');
    
    try {
      // mediaStreamSource 연결 해제
      if (this.mediaStreamSource) {
        this.mediaStreamSource.disconnect();
      }
      
      // 기존 gainNode 연결 해제
      if (this.gainNode) {
        this.gainNode.disconnect();
      }
      
      // 기존 analyserNode 연결 해제
      if (this.analyserNode) {
        this.analyserNode.disconnect();
      }
      
      // 모든 필터 노드 연결 해제
      for (const filter of this.filters.values()) {
        filter.disconnect();
      }
      
      console.log('[setupAudioChain] ✓ 기존 노드 연결 모두 해제 완료');
    } catch (error) {
      console.warn('[setupAudioChain] 연결 해제 중 경고:', error);
    }

    // **Step 2: 新 노드 생성 및 연결**
    /**
     * GainNode 생성
     * audioContext.createGain(): GainNode
     * - 신호 진폭을 선형 배수로 조정하는 노드
     * - 파라미터: gain (AudioParam) - 기본값 1.0
     * - 범위: -∞ ~ +∞ (실제용도: 0.0~2.0)
     * - 시간 변경 가능 (ramp 함수): linearRampToValueAtTime, exponentialRampToValueAtTime 등
     */
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;  // 기본 게인 1.0 (무변화)

    /**
     * AnalyserNode 생성
     * audioContext.createAnalyser(): AnalyserNode
     * - 실시간 오디오 신호의 주파수/시간 도메인 데이터 분석
     * - FFT 크기 설정으로 주파수 해상도 조정
     * - Popup에서 requestAnimationFrame 루프로 getByteFrequencyData() 호출
     */
    this.analyserNode = this.audioContext.createAnalyser();
    /**
     * fftSize: 2의 배수 (2048이 최신 권장)
     * - FFT 크기 = 시간 도메인 샘플 수
     * - 2048 샘플 @ 48kHz ≈ 42.67ms 윈도우
     * - frequencyBinCount = fftSize / 2 = 1024개의 주파수 빈
     * - 각 빈 대역폭 = 48000 / 2048 ≈ 23.4 Hz (주파수 해상도)
     */
    this.analyserNode.fftSize = 2048;

    /**
     * 오디오 노드 직렬 연결
     * AudioNode.connect(destination: AudioNode | AudioContext): AudioNode
     * - 현재 노드의 출력을 다음 노드의 입력에 연결
     * - 반환값: destination (메서드 체이닝 가능)
     * - 단방향 그래프: 순환 연결 불가
     */
    let currentNode: AudioNode = this.mediaStreamSource;

    // 단계 1: MediaStreamSource → 필터 체인 (직렬 연결)
    for (const nodeId of this.filterNodeIds) {
      const filter = this.filters.get(nodeId);
      if (filter) {
        /**
         * connect 메서드 사용:
         * - currentNode: 현재 처리 단계의 오디오 노드
         * - filter: BiquadFilterNode (다음 처리 단계)
         * 
         * 연결 의미: currentNode의 출력 → filter의 입력
         * 필터의 파라미터(frequency, Q, gain)에 따라 신호 변조
         */
        currentNode.connect(filter);
        currentNode = filter;  // 다음 순회용 포인터 이동
      }
    }

    // 단계 2: 필터 체인 출력 → 마스터 게인 (볼륨 제어)
    currentNode.connect(this.gainNode);

    // 단계 3: 마스터 게인 → 분석기 (스펙트럼 데이터 추출)
    /**
     * 분석기 노드는 신호를 "소비"하지 않음
     * - 입력 신호의 복사본 분석
     * - 실시간 주파수 데이터만 제공
     * - 음성 손상 없음
     */
    this.gainNode.connect(this.analyserNode);

    // 단계 4: 최종 신호 → 스피커 (오디오 렌더러 출력)
    /**
     * audioContext.destination: AudioDestinationNode
     * - 오디오 컨텍스트의 최종 출력 노드
     * - 클라이언트 오디오 장치(스피커, 이어폰)로 라우팅
     * - 모든 처리 완료된 신호 → 스피커 출력
     */
    this.analyserNode.connect(this.audioContext.destination);

    console.log('✓ 오디오 노드 그래프 구성 완료:');
    console.log(`  Source → [${this.filters.size} 필터] → Gain → Analyser → Destination`);
  }

  /**
   * 초기 필터 체인 생성 (5개 밴드 EQ)
   */
  private createInitialFilterChain() {
    if (!this.audioContext) {
      console.error('[createInitialFilterChain] audioContext가 초기화되지 않음');
      return;
    }

    // 음악 산업 표준 5밴드 주파수: 저주파, 준저주파, 미드, 준고주파, 고주파
    const frequencies = [500, 1500, 3000, 5000, 8000];  // Hz 단위

    for (let i = 0; i < frequencies.length; i++) {
      const nodeId = i;
      const filter = this.createBiquadFilter(frequencies[i]);
      this.filters.set(nodeId, filter);
      this.filterNodeIds.push(nodeId);
    }

    console.log(`✓ 초기 필터 체인 생성 완료: ${frequencies.length}개 BiquadFilterNode`);
  }

  /**
   * BiquadFilterNode 생성 헬퍼 함수
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

  /**
   * 필터 추가 (동적 노드 추가용)
   */
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
    
    // 필터 추가 후 오디오 체인 재구성 (동적 갱신)
    this.setupAudioChain();
    
    return true;
  }

  /**
   * 필터 제거 (동적 노드 제거용)
   */
  removeFilter(nodeId: number): boolean {
    if (!this.filters.has(nodeId)) {
      console.error(`필터 ${nodeId}을 찾을 수 없습니다.`);
      return false;
    }

    this.filters.delete(nodeId);
    this.filterNodeIds = this.filterNodeIds.filter(id => id !== nodeId);
    
    console.log(`필터 ${nodeId} 제거 완료`);
    
    // 필터 제거 후 오디오 체인 재구성 (동적 갱신)
    this.setupAudioChain();
    
    return true;
  }

  /**
   * BiquadFilterNode를 이용한 파라메트릭 필터 체인 생성 (레거시 - 사용 안함)
   */
  private createFilterChain(count: number) {
    // 이 메서드는 더 이상 사용되지 않습니다.
  }

  /**
   * 특정 필터 설정 변경
   */
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

    console.log(`필터 ${nodeId} 업데이트 완료:`, config);
  }

  /**
   * 주파수 스펙트럼 데이터 추출
   */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) return null;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);

    return dataArray;
  }

  /**
   * 전체 이득 설정
   */
  setMasterGain(gain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2, gain));
    }
  }

  /**
   * 현재 상태 반환
   */
  getStatus() {
    const filterArray: any[] = [];
    for (const nodeId of this.filterNodeIds) {
      const filter = this.filters.get(nodeId);
      if (filter) {
        filterArray.push({
          nodeId: nodeId,
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
}

// 전역 AudioProcessor 인스턴스
const audioProcessor = new AudioProcessor();

/**
 * Offscreen Document 준비 완료 신호를 Background로 전송
 * Background는 이 신호를 기다렸다가 tabCapture를 시작
 */
chrome.runtime.sendMessage({
  type: 'OFFSCREEN_READY',
  message: 'Offscreen document와 AudioProcessor 초기화 완료'
}).catch(error => {
  // Background가 아직 준비되지 않았을 수 있으므로 무시
  console.log('[Offscreen] Background 메시지 전송 실패 (정상):', error);
});

/**
 * Chrome 메시지 리스너 (Background ↔ Offscreen 양방향 통신)
 * 
 * chrome.runtime.onMessage.addListener(callback)
 * - callback(request: object, sender: MessageSender, sendResponse: function): boolean
 * - request: 발신자가 전송한 메시지 객체
 * - sender: MessageSender - 발신자의 컨텍스트 정보 (id, url, tab 등)
 * - sendResponse: (response: object) => void - 발신자로 응답 전송 함수
 * - 반환값: true면 sendResponse 비동기 호출 허용 (필요시 명시)
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  try {
    switch (request.type) {
      /**
       * Background Service Worker → Offscreen: Manifest V3 호환 오디오 스트림 설정
       * 
       * chrome.tabCapture.getMediaStreamId()로 획득한 streamId를 받아
       * navigator.mediaDevices.getUserMedia(chromeMediaSourceId: streamId)로 실제 스트림 획득
       * 
       * 메시지 구조:
       * {
       *   type: 'SETUP_MEDIA_STREAM',
       *   streamId: string,  // chrome.tabCapture.getMediaStreamId()로부터 획득한 토큰
       *   tabId: number      // 미디어 소스 탭 ID
       * }
       * 
       * 동작:
       * 1. navigator.mediaDevices.getUserMedia() 호출
       *    - constraints.audio.chromeMediaSourceId = streamId 지정
       *    - constraints.audio.mandatory.chromeMediaSource = 'tab' 지정
       * 2. MediaStream 획득
       * 3. AudioProcessor.connectMediaStream() 호출하여 Web Audio처리 시작
       */
      case 'SETUP_MEDIA_STREAM':
        if (typeof request.streamId === 'string') {
          console.log('[Offscreen] SETUP_MEDIA_STREAM 메시지 수신 - getUserMedia 호출 시작');
          audioProcessor.setupMediaStreamFromId(request.streamId)
            .then(() => {
              sendResponse({ success: true, message: '미디어 스트림 설정 완료' });
            })
            .catch((error: Error) => {
              console.error('[Offscreen] getUserMedia 실패:', error);
              sendResponse({ success: false, error: error.message });
            });
          return true; // 비동기 응답을 위해 true 반환
        } else {
          console.error('[Offscreen] 유효하지 않은 streamId');
          sendResponse({ success: false, error: 'streamId는 문자열이어야 합니다.' });
        }
        break;

      /**
       * START_CAPTURE / STOP_CAPTURE는 Popup → Background 메시지인데,
       * chrome.runtime.sendMessage()가 모든 수신자에게 브로드캐스트되므로
       * Offscreen도 받습니다. 이를 gracefully 무시합니다.
       */
      case 'START_CAPTURE':
      case 'STOP_CAPTURE':
        // Popup에서 Background로 보낸 메시지가 Offscreen까지 전달됨 (정상)
        // 응답 없이 무시
        break;

      /**
       * Legacy: Background Service Worker → Offscreen: 오디오 스트림 수신 (사용 안함)
       * 
       * Manifest V3에서는 Service Worker가 MediaStream을 직접 생성할 수 없으므로
       * 더 이상 사용되지 않습니다. SETUP_MEDIA_STREAM을 사용하세요.
       */
      case 'CAPTURE_AUDIO_STREAM':
        if (request.stream instanceof MediaStream) {
          console.log('[Offscreen] CAPTURE_AUDIO_STREAM 메시지 수신 (레거시 - 사용 안함)');
          audioProcessor.connectMediaStream(request.stream);
          sendResponse({ success: true, message: '오디오 스트림 연결 완료' });
        } else {
          console.error('[Offscreen] 유효하지 않은 stream 객체');
          sendResponse({ success: false, error: 'Stream은 MediaStream 타입이어야 합니다.' });
        }
        break;

      /**
       * Background Service Worker → Offscreen: 미디어 스트림 정리
       * 
       * 팝업이 닫혔거나 캡처를 중지할 때 호출
       * 현재는 placeholder이지만 향후 리소스 정리에 사용 가능
       */
      case 'CLEANUP_MEDIA_STREAM':
        console.log('[Offscreen] CLEANUP_MEDIA_STREAM - 미디어 스트림 정리 신호 수신');
        // TODO: 스트림 정리 로직 (필요시)
        // - mediaStreamSource 정리
        // - 필터 리셋
        // - AudioContext 재설정
        sendResponse({ success: true, message: '미디어 스트림 정리 완료' });
        break;

      /**
       * Popup → Offscreen: 새 필터 추가
       * 
       * 메시지:
       * {
       *   type: 'ADD_FILTER',
       *   nodeId: number,      // 노드 ID
       *   frequency: number    // Hz (20 ~ 20000)
       * }
       */
      case 'ADD_FILTER':
        const addSuccess = audioProcessor.addFilter(request.nodeId, request.frequency);
        sendResponse({ success: addSuccess });
        break;

      /**
       * Popup ↔ Offscreen: 개별 필터 파라미터 업데이트
       * 
       * 메시지:
       * {
       *   type: 'UPDATE_FILTER',
       *   nodeId: number,  // 노드 ID
       *   config: {
       *     gain?: number,        // dB 값 (-12 ~ +12)
       *     Q?: number,           // 대역폭 (0.1 ~ 10.0)
       *     frequency?: number,   // Hz (20 ~ 20000)
       *     type?: BiquadFilterType  // 'peaking', 'lowshelf', etc.
       *   }
       * }
       */
      case 'UPDATE_FILTER':
        audioProcessor.updateFilter(request.nodeId, request.config);
        sendResponse({ success: true });
        break;

      /**
       * Popup ↔ Offscreen: 필터 제거
       * 
       * 메시지:
       * {
       *   type: 'REMOVE_FILTER',
       *   nodeId: number  // 제거할 노드 ID
       * }
       */
      case 'REMOVE_FILTER':
        const success = audioProcessor.removeFilter(request.nodeId);
        sendResponse({ success });
        break;

      /**
       * Popup ↔ Offscreen: 실시간 주파수 스펙트럼 데이터 요청
       * 
       * 동작:
       * 1. AnalyserNode.getByteFrequencyData(dataArray) 호출
       *    - 매 프레임 호출 (Popup의 requestAnimationFrame 루프)
       * 2. Uint8Array (0-255 범위의 주파수 강도) 반환
       * 3. Popup에서 Canvas에 렌더링하여 시각화
       */
      case 'GET_FREQUENCY_DATA':
        const frequencyData = audioProcessor.getFrequencyData();
        sendResponse({ frequencyData: frequencyData ? Array.from(frequencyData) : null });
        break;

      /**
       * Popup ↔ Offscreen: 마스터 게인 설정
       * 
       * 메시지:
       * {
       *   type: 'SET_MASTER_GAIN',
       *   gain: number  // 선형 모드: 0.0 ~ 2.0 (1.0 = 무변화)
       * }
       */
      case 'SET_MASTER_GAIN':
        audioProcessor.setMasterGain(request.gain);
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse(audioProcessor.getStatus());
        break;

      default:
        console.warn(`[Offscreen] 알 수 없는 메시지 타입: ${request.type}`);
        sendResponse({ error: '알 수 없는 요청 타입' });
    }
  } catch (error) {
    console.error('[Offscreen] 메시지 처리 중 예외 발생:', error);
    try {
      sendResponse({ success: false, error: '메시지 처리 중 오류 발생' });
    } catch (_) {
      // sendResponse 호출 실패 (메시지 채널이 이미 닫혔을 가능성)
      console.warn('[Offscreen] sendResponse 호출 실패 (메시지 채널 이미 종료)');
    }
  }

  // true: sendResponse의 비동기 호출을 허용 (필요시)
  return true;
});

export {};
