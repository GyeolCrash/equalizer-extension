/**
 * Offscreen Document (Manifest V3)
 * Web Audio API 오디오 컨텍스트 관리 및 필터 체인 구성
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
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private gainNode: GainNode | null = null;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('AudioContext 초기화 완료');
    } catch (error) {
      console.error('AudioContext 초기화 실패:', error);
    }
  }

  /**
   * MediaStream을 오디오 컨텍스트에 연결
   */
  connectMediaStream(stream: MediaStream) {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    try {
      this.mediaStreamSource = this.audioContext!.createMediaStreamSource(stream);
      this.setupAudioChain();
      console.log('MediaStream 연결 완료');
    } catch (error) {
      console.error('MediaStream 연결 실패:', error);
    }
  }

  /**
   * 오디오 체인 구성: 소스 → 필터 → 이득 → 분석기 → 목적지
   */
  private setupAudioChain() {
    if (!this.mediaStreamSource || !this.audioContext) return;

    // 이득 노드 생성
    this.gainNode = this.audioContext.createGain();

    // 분석기 노드 생성 (스펙트럼 데이터 추출용)
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // 필터 체인 초기화 (기본 5개 필터)
    this.createFilterChain(5);

    // 노드 연결: 소스 → 필터 → 이득 → 분석기 → 목적지
    let currentNode: AudioNode = this.mediaStreamSource;

    for (const filter of this.filters) {
      currentNode.connect(filter);
      currentNode = filter;
    }

    currentNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    console.log('오디오 체인 구성 완료');
  }

  /**
   * BiquadFilterNode를 이용한 필터 체인 생성
   */
  private createFilterChain(count: number) {
    if (!this.audioContext) return;

    this.filters = [];
    const frequencies = [100, 500, 1000, 4000, 8000]; // Hz 단위

    for (let i = 0; i < count; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequencies[i] || 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;

      this.filters.push(filter);
    }

    console.log(`${count}개 필터 생성 완료`);
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

// Chrome 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'SETUP_AUDIO':
      if (request.stream instanceof MediaStream) {
        audioProcessor.connectMediaStream(request.stream);
        sendResponse({ success: true });
      }
      break;

    case 'UPDATE_FILTER':
      audioProcessor.updateFilter(request.filterIndex, request.config);
      sendResponse({ success: true });
      break;

    case 'GET_FREQUENCY_DATA':
      const frequencyData = audioProcessor.getFrequencyData();
      sendResponse({ data: frequencyData });
      break;

    case 'SET_MASTER_GAIN':
      audioProcessor.setMasterGain(request.gain);
      sendResponse({ success: true });
      break;

    case 'GET_STATUS':
      sendResponse(audioProcessor.getStatus());
      break;

    default:
      sendResponse({ error: '알 수 없는 요청' });
  }
});

export {};
