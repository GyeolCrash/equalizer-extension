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

  // BiquadFilterNode 배열: 파라메트릭 이퀄라이저 구현
  // - 각 필터는 독립적인 주파수 영역 제어 (100Hz, 500Hz, 1kHz, 4kHz, 8kHz)
  // - type별로 Peaking(밴드 EQ), Shelf(기울기), Pass(필터링) 지원
  private filters: BiquadFilterNode[] = [];

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
   * 신호 흐름 (직렬 연결):
   * MediaStreamAudioSourceNode
   *    ↓ AudioNode.connect(AudioNode)
   * BiquadFilterNode[0] (100 Hz Peaking)
   *    ↓
   * BiquadFilterNode[1] (500 Hz Peaking)
   *    ↓
   * BiquadFilterNode[2] (1 kHz Peaking)
   *    ↓
   * BiquadFilterNode[3] (4 kHz Peaking)
   *    ↓
   * BiquadFilterNode[4] (8 kHz Peaking)
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

    // 파라메트릭 필터 체인 초기화 (5개 밴드 EQ)
    this.createFilterChain(5);

    /**
     * 오디오 노드 직렬 연결
     * AudioNode.connect(destination: AudioNode | AudioContext): AudioNode
     * - 현재 노드의 출력을 다음 노드의 입력에 연결
     * - 반환값: destination (메서드 체이닝 가능)
     * - 단방향 그래프: 순환 연결 불가
     */
    let currentNode: AudioNode = this.mediaStreamSource;

    // 단계 1: MediaStreamSource → 필터 체인 (직렬 연결)
    for (const filter of this.filters) {
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
    console.log(`  Source → [${this.filters.length} 필터] → Gain → Analyser → Destination`);
  }

  /**
   * BiquadFilterNode를 이용한 파라메트릭 필터 체인 생성
   * 
   * BiquadFilterNode: 이차 필터(Biquad = 2nd-order)
   * - 주파수 영역에서 신호를 선택적으로 증폭/감쇠
   * - Pro-Q 같은 DSP 이퀄라이저의 핵심 구성요소
   * - 5개 필터로 5밴드 파라메트릭 EQ 구현
   * 
   * @param count 생성할 필터 개수
   */
  private createFilterChain(count: number) {
    if (!this.audioContext) {
      console.error('[createFilterChain] audioContext가 초기화되지 않음');
      return;
    }

    this.filters = [];
    // 음악 산업 표준 5밴드 주파수: 저주파, 준저주파, 미드, 준고주파, 고주파
    const frequencies = [100, 500, 1000, 4000, 8000];  // Hz 단위

    for (let i = 0; i < count; i++) {
      /**
       * audioContext.createBiquadFilter(): BiquadFilterNode
       * - 2차 IIR 필터 구현
       * - 파라미터 (AudioParam):
       *   * type: 필터 특성 (peaking, lowshelf, highshelf, lowpass, highpass, notch, allpass)
       *   * frequency: 중심 주파수 (20Hz ~ 20kHz)
       *   * Q: 질 팩터 = 중심주파수 / 대역폭 (0.001 ~ 1000)
       *   * gain: 이득 (-40dB ~ +40dB), peaking/shelf 타입에만 적용
       */
      const filter = this.audioContext.createBiquadFilter();

      /**
       * 필터 타입 설정: 'peaking'
       * - 중심 주파수 주변을 선택적으로 증폭/감쇠
       * - gain > 0: 부스트 (해당 주파수 강화)
       * - gain < 0: 컷 (해당 주파수 약화)
       * - 음악 이퀄라이저의 표준 모드
       */
      filter.type = 'peaking';

      /**
       * 중심 주파수 설정
       * - 휴먼 오디션의 주요 감지 주파수 선택
       * - 100 Hz (베이스 풍부함)
       * - 500 Hz (음성/악기 따뜻함)
       * - 1 kHz (음성 명확도)
       * - 4 kHz (음성 선명도)
       * - 8 kHz (고주파 세부사항)
       */
      filter.frequency.value = frequencies[i] || 1000;

      /**
       * Q 값 (대역폭) 설정
       * - Q = 1: 1 옥타브 범위 영향
       * - Q = 10: 좁은 범위, 정밀한 제어
       * - 초기값 1.0으로 설정 후 UI에서 사용자 조정 가능
       */
      filter.Q.value = 1.0;

      /**
       * 초기 게인값
       * - 0 dB: 무 변화 (필터 비활성)
       * - 사용자가 Popup에서 슬라이더로 변경 (-12dB ~ +12dB)
       */
      filter.gain.value = 0;

      this.filters.push(filter);
    }

    console.log(`✓ 필터 체인 생성 완료: ${count}개 BiquadFilterNode`);
    this.filters.forEach((f, i) => {
      console.log(`  [${i}] ${frequencies[i]}Hz - type:${f.type}, Q:${f.Q.value}, gain:${f.gain.value}dB`);
    });
  }

  /**
   * 특정 필터 설정 변경
   */
  updateFilter(index: number, config: Partial<FilterConfig>) {
    if (index < 0 || index >= this.filters.length) {
      console.error('유효하지 않은 필터 인덱스:', index);
      return;
    }

    const filter = this.filters[index];

    if (config.type) filter.type = config.type;
    if (config.frequency !== undefined) filter.frequency.value = config.frequency;
    if (config.Q !== undefined) filter.Q.value = config.Q;
    if (config.gain !== undefined) filter.gain.value = config.gain;

    console.log(`필터 ${index} 업데이트 완료:`, config);
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
    return {
      isRunning: this.audioContext?.state === 'running',
      filters: this.filters.map((f, i) => ({
        index: i,
        type: f.type,
        frequency: f.frequency.value,
        Q: f.Q.value,
        gain: f.gain.value
      }))
    };
  }
}

// 전역 AudioProcessor 인스턴스
const audioProcessor = new AudioProcessor();

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
  switch (request.type) {
    /**
     * Background Service Worker → Offscreen: 오디오 스트림 수신
     * 
     * 메시지 구조:
     * {
     *   type: 'CAPTURE_AUDIO_STREAM',
     *   stream: MediaStream  // chrome.tabCapture.capture() 결과
     * }
     * 
     * 동작:
     * 1. request.stream 객체의 타입 검증 (instanceof MediaStream)
     * 2. AudioProcessor.connectMediaStream() 호출
     *    - createMediaStreamSource로 Web Audio 그래프에 연결
     *    - setupAudioChain()으로 필터 체인 구성
     *    - 오디오 처리 시작
     */
    case 'CAPTURE_AUDIO_STREAM':
      if (request.stream instanceof MediaStream) {
        console.log('[Offscreen] CAPTURE_AUDIO_STREAM 메시지 수신 - 오디오 파이프라인 구축 시작');
        audioProcessor.connectMediaStream(request.stream);
        sendResponse({ success: true, message: '오디오 스트림 연결 완료' });
      } else {
        console.error('[Offscreen] 유효하지 않은 stream 객체');
        sendResponse({ success: false, error: 'Stream은 MediaStream 타입이어야 합니다.' });
      }
      break;

    /**
     * Popup ↔ Offscreen: 개별 필터 파라미터 업데이트
     * 
     * 메시지:
     * {
     *   type: 'UPDATE_FILTER',
     *   filterIndex: number,  // 필터 배열 인덱스 (0-4)
     *   config: {
     *     gain?: number,        // dB 값 (-12 ~ +12)
     *     Q?: number,           // 대역폭 (0.1 ~ 10.0)
     *     frequency?: number,   // Hz (20 ~ 20000)
     *     type?: BiquadFilterType  // 'peaking', 'lowshelf', etc.
     *   }
     * }
     */
    case 'UPDATE_FILTER':
      audioProcessor.updateFilter(request.filterIndex, request.config);
      sendResponse({ success: true });
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
      sendResponse({ data: frequencyData });
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

  // true: sendResponse의 비동기 호출을 허용 (필요시)
  return true;
});

export {};
