/**
 * Offscreen Document
 * 포트 통신 기반의 웹 오디오 API 엔진
 */

interface FilterConfig {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private filters: Map<number, BiquadFilterNode> = new Map();
  private filterNodeIds: number[] = [];
  private gainNode: GainNode | null = null;
  private backgroundPort: chrome.runtime.Port;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.backgroundPort = chrome.runtime.connect({ name: 'offscreen-port' });
    this.setupPortListener();
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
  }

  private setupPortListener() {
    this.backgroundPort.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case 'SETUP_MEDIA_STREAM':
          await this.setupMediaStream(msg.streamId);
          break;
        case 'CLEANUP_MEDIA_STREAM':
          this.cleanup();
          break;
        case 'ADD_FILTER':
          this.addFilter(msg.nodeId, msg.frequency);
          break;
        case 'UPDATE_FILTER':
          this.updateFilter(msg.nodeId, msg.config);
          break;
        case 'REMOVE_FILTER':
          this.removeFilter(msg.nodeId);
          break;
        case 'SET_MASTER_GAIN':
          this.setMasterGain(msg.gain);
          break;
        case 'GET_STATUS':
          this.backgroundPort.postMessage({ type: 'SYNC_STATUS', data: this.getStatus() });
          break;
        case 'GET_FREQUENCY_DATA':
          const data = this.getFrequencyData();
          if (data) {
            this.backgroundPort.postMessage({ type: 'SYNC_FREQUENCY_DATA', data: Array.from(data) });
          }
          break;
      }
    });
  }

  private async setupMediaStream(streamId: string) {
    this.cleanup();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as any,
        video: false
      });
      this.mediaStreamSource = this.audioContext!.createMediaStreamSource(this.mediaStream);
      if (this.audioContext!.state === 'suspended') await this.audioContext!.resume();
      this.setupAudioChain();
    } catch (err) {
      console.error('[Offscreen] 스트림 마운트 실패:', err);
    }
  }

  private setupAudioChain() {
    if (!this.mediaStreamSource || !this.audioContext) return;
    if (this.gainNode) this.gainNode.disconnect();
    if (this.analyserNode) this.analyserNode.disconnect();
    for (const filter of this.filters.values()) filter.disconnect();

    this.gainNode = this.audioContext.createGain();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    let currentNode: AudioNode = this.mediaStreamSource;
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
  }

  private addFilter(nodeId: number, frequency: number) {
    if (!this.audioContext || this.filters.has(nodeId)) return;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1.0;
    filter.gain.value = 0;
    this.filters.set(nodeId, filter);
    this.filterNodeIds.push(nodeId);
    if (this.mediaStreamSource) this.setupAudioChain();
  }

  private removeFilter(nodeId: number) {
    const filter = this.filters.get(nodeId);
    if (!filter) return;
    filter.disconnect();
    this.filters.delete(nodeId);
    this.filterNodeIds = this.filterNodeIds.filter(id => id !== nodeId);
    if (this.mediaStreamSource) this.setupAudioChain();
  }

  private updateFilter(nodeId: number, config: Partial<FilterConfig>) {
    const filter = this.filters.get(nodeId);
    if (!filter) return;
    if (config.type) filter.type = config.type;
    if (config.frequency !== undefined) filter.frequency.value = config.frequency;
    if (config.Q !== undefined) filter.Q.value = config.Q;
    if (config.gain !== undefined) filter.gain.value = config.gain;
  }

  private getFrequencyData() {
    if (!this.analyserNode) return null;
    const data = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(data);
    return data;
  }

  private setMasterGain(gain: number) {
    if (this.gainNode) this.gainNode.gain.value = gain;
  }

  private getStatus() {
    return {
      filters: this.filterNodeIds.map(id => {
        const f = this.filters.get(id)!;
        return { nodeId: id, type: f.type, frequency: f.frequency.value, Q: f.Q.value, gain: f.gain.value };
      })
    };
  }

  private cleanup() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
  }
}

new AudioProcessor();
export {};