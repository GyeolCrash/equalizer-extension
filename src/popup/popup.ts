/**
 * Graph-based Audio Equalizer - Pro-Q 스타일 UI
 * 
 * [FIX LOG]
 * 1. 자동 캡처와 버튼 상태 동기화 (이전: 자동 캡처 시작하지만 버튼은 "시작" 상태)
 * 2. startCapture/stopCapture 함수 분리
 * 3. 중복 START_CAPTURE 방지
 */

interface EQNode {
  id: number;
  frequency: number;
  Q: number;
  gain: number;
  type: BiquadFilterType;
  color: string;
}

class EQVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: EQNode[] = [];
  private selectedNodeId: number | null = null;
  private draggingNode: EQNode | null = null;
  private nextNodeId = 0;
  private frequencyData: Uint8Array | null = null;
  private isVisualizationRunning = false;

  private graphWidth = 800;
  private graphHeight = 250;
  private padding = 40;
  private frequency10kHz = 10000;

  private colorPalette = [
    '#FF4444', '#44FF44', '#4444FF', '#FFD700', '#FF00FF',
    '#00FFFF', '#FFA500', '#00FF00', '#FF6699', '#FFFF00'
  ];

  constructor() {
    this.canvas = document.getElementById('eqGraph') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    this.setupEventListeners();
    this.startVisualization();
    this.drawGraph();
  }

  private setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const node = this.getNodeAtPosition(x, y);

      if (node) {
        this.selectNode(node.id);
        this.draggingNode = node;
      } else if (this.isInGraphArea(x, y)) {
        if (this.nodes.length < 5) {
          this.addNode(x, y);
          this.draggingNode = this.nodes[this.nodes.length - 1];
        } else {
          console.warn('최대 5개의 필터만 추가 가능합니다.');
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.draggingNode) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.isInGraphArea(x, y)) {
        this.draggingNode.frequency = this.xToFrequency(x);
        this.draggingNode.gain = this.yToGain(y);

        this.draggingNode.frequency = Math.max(20, Math.min(10000, this.draggingNode.frequency));
        this.draggingNode.gain = Math.max(-12, Math.min(12, this.draggingNode.gain));

        this.updateControlPanel();
        this.drawGraph();
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.draggingNode) {
        this.sendFilterUpdate(this.draggingNode.id);
        this.draggingNode = null;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const node = this.getNodeAtPosition(x, y);
      if (node) {
        this.removeNode(node.id);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.selectedNodeId !== null) {
        this.removeNode(this.selectedNodeId);
      }
    });

    window.addEventListener('resize', () => {
      this.drawGraph();
    });
  }

  private isInGraphArea(x: number, y: number): boolean {
    return x >= this.padding && x <= this.graphWidth - this.padding &&
           y >= this.padding && y <= this.graphHeight - this.padding;
  }

  addNode(x: number, y: number) {
    if (this.nodes.length >= 5) {
      console.warn('최대 5개의 필터만 추가 가능합니다.');
      return;
    }

    const id = this.nextNodeId++;
    const node: EQNode = {
      id,
      frequency: this.xToFrequency(x),
      Q: 1.0,
      gain: this.yToGain(y),
      type: 'peaking',
      color: this.colorPalette[this.nodes.length % this.colorPalette.length]
    };

    this.nodes.push(node);
    this.selectNode(id);

    chrome.runtime.sendMessage({
      type: 'ADD_FILTER',
      nodeId: id,
      frequency: Math.round(node.frequency)
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`ADD_FILTER 에러 (nodeId=${id}):`, chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) {
        this.sendFilterUpdate(id);
      } else {
        console.error(`필터 ${id} 추가 실패`);
      }
    });

    this.updateNodeList();
    this.drawGraph();
  }

  removeNode(nodeId: number) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index === -1) return;

    this.nodes.splice(index, 1);

    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = this.nodes.length > 0 ? this.nodes[0].id : null;
    }

    chrome.runtime.sendMessage({
      type: 'REMOVE_FILTER',
      nodeId: nodeId
    }, () => {});

    this.updateNodeList();
    this.updateControlPanel();
    this.drawGraph();
  }

  selectNode(nodeId: number) {
    this.selectedNodeId = nodeId;
    this.updateControlPanel();
    this.updateNodeList();
    this.drawGraph();
  }

  private updateControlPanel() {
    const panel = document.getElementById('controlPanel') as HTMLDivElement;
    if (!panel || this.selectedNodeId === null) {
      if (panel) panel.innerHTML = '<p>노드를 선택하세요</p>';
      return;
    }

    const node = this.nodes.find(n => n.id === this.selectedNodeId);
    if (!node) return;

    panel.innerHTML = `
      <div class="info-group">
        <label>Node ${node.id + 1}</label>
      </div>
      <div class="info-group">
        <label>Frequency:</label>
        <input type="number" id="freqInput" value="${Math.round(node.frequency)}" min="20" max="20000" />
        <span>Hz</span>
      </div>
      <div class="info-group">
        <label>Q:</label>
        <input type="number" id="qInput" value="${node.Q.toFixed(1)}" min="0.1" max="10" step="0.1" />
      </div>
      <div class="info-group">
        <label>Gain:</label>
        <input type="number" id="gainInput" value="${node.gain.toFixed(1)}" min="-12" max="12" step="0.1" />
        <span>dB</span>
      </div>
      <div class="info-group">
        <label>Filter:</label>
        <select id="filterSelect">
          <option value="peaking" ${node.type === 'peaking' ? 'selected' : ''}>Peaking</option>
          <option value="lowshelf" ${node.type === 'lowshelf' ? 'selected' : ''}>Low Shelf</option>
          <option value="highshelf" ${node.type === 'highshelf' ? 'selected' : ''}>High Shelf</option>
          <option value="lowpass" ${node.type === 'lowpass' ? 'selected' : ''}>Low Pass</option>
          <option value="highpass" ${node.type === 'highpass' ? 'selected' : ''}>High Pass</option>
        </select>
      </div>
    `;

    const freqInput = document.getElementById('freqInput') as HTMLInputElement;
    const qInput = document.getElementById('qInput') as HTMLInputElement;
    const gainInput = document.getElementById('gainInput') as HTMLInputElement;
    const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;

    freqInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const n = this.nodes.find(n => n.id === this.selectedNodeId);
        if (n) { n.frequency = parseFloat(freqInput.value); this.sendFilterUpdate(n.id); this.drawGraph(); }
      }
    });

    qInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const n = this.nodes.find(n => n.id === this.selectedNodeId);
        if (n) { n.Q = parseFloat(qInput.value); this.sendFilterUpdate(n.id); this.drawGraph(); }
      }
    });

    gainInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const n = this.nodes.find(n => n.id === this.selectedNodeId);
        if (n) { n.gain = parseFloat(gainInput.value); this.sendFilterUpdate(n.id); this.drawGraph(); }
      }
    });

    filterSelect.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const n = this.nodes.find(n => n.id === this.selectedNodeId);
        if (n) { n.type = filterSelect.value as BiquadFilterType; this.sendFilterUpdate(n.id); this.drawGraph(); }
      }
    });
  }

  private updateNodeList() {
    const listContainer = document.getElementById('nodeList') as HTMLDivElement;
    listContainer.innerHTML = '';

    this.nodes.forEach((node, index) => {
      const item = document.createElement('div');
      item.className = `node-item ${this.selectedNodeId === node.id ? 'selected' : ''}`;
      item.innerHTML = `<span>${index + 1}</span>`;
      item.addEventListener('click', () => {
        this.selectNode(node.id);
      });
      listContainer.appendChild(item);
    });
  }

  private getNodeAtPosition(x: number, y: number): EQNode | null {
    const hitRadius = 12;
    for (const node of this.nodes) {
      const nodeX = this.frequencyToX(node.frequency);
      const nodeY = this.gainToY(node.gain);
      const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
      if (distance <= hitRadius) return node;
    }
    return null;
  }

  private frequencyToX(frequency: number): number {
    const logFreq = Math.log10(Math.max(20, frequency));
    const logMin = Math.log10(20);
    const logMax = Math.log10(this.frequency10kHz);
    return this.padding + ((logFreq - logMin) / (logMax - logMin)) * (this.graphWidth - 2 * this.padding);
  }

  private xToFrequency(x: number): number {
    const normalized = (x - this.padding) / (this.graphWidth - 2 * this.padding);
    const logMin = Math.log10(20);
    const logMax = Math.log10(this.frequency10kHz);
    return Math.pow(10, logMin + normalized * (logMax - logMin));
  }

  private gainToY(gain: number): number {
    return this.graphHeight - this.padding - ((gain + 12) / 24) * (this.graphHeight - 2 * this.padding);
  }

  private yToGain(y: number): number {
    return ((this.graphHeight - this.padding - y) / (this.graphHeight - 2 * this.padding)) * 24 - 12;
  }

  private startVisualization() {
    if (this.isVisualizationRunning) return;
    this.isVisualizationRunning = true;

    const updateLoop = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_FREQUENCY_DATA' },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (response?.frequencyData) {
            this.frequencyData = new Uint8Array(response.frequencyData);
          }
        }
      );
      this.drawGraph();
      requestAnimationFrame(updateLoop);
    };
    updateLoop();
  }

  private drawGraph() {
    const { ctx, canvas, graphWidth, graphHeight, padding } = this;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(padding, padding, graphWidth - 2 * padding, graphHeight - 2 * padding);

    this.drawFrequencySpectrum();
    this.drawGridLines();
    this.drawFilterCurve();
    this.drawNodes();
    this.drawAxisLabels();
  }

  private drawFrequencySpectrum() {
    if (!this.frequencyData) return;
    const { ctx, padding, graphWidth, graphHeight } = this;
    const data = this.frequencyData;
    const barWidth = (graphWidth - 2 * padding) / data.length;

    ctx.fillStyle = 'rgba(100, 200, 255, 0.1)';
    for (let i = 0; i < data.length; i++) {
      const value = data[i] / 255;
      const barHeight = value * (graphHeight - 2 * padding);
      ctx.fillRect(padding + i * barWidth, graphHeight - padding - barHeight, barWidth, barHeight);
    }
  }

  private drawGridLines() {
    const { ctx, padding, graphWidth, graphHeight } = this;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;

    [20, 100, 500, 1000, 5000, 10000].forEach((freq) => {
      const x = this.frequencyToX(freq);
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, graphHeight - padding); ctx.stroke();
    });

    [-12, -6, 0, 6, 12].forEach((gain) => {
      const y = this.gainToY(gain);
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(graphWidth - padding, y); ctx.stroke();
    });

    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    const centerY = this.gainToY(0);
    ctx.beginPath(); ctx.moveTo(padding, centerY); ctx.lineTo(graphWidth - padding, centerY); ctx.stroke();
  }

  private drawFilterCurve() {
    const { ctx, padding, graphWidth } = this;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (let x = padding; x < graphWidth - padding; x += 2) {
      const frequency = this.xToFrequency(x);
      let totalGain = 0;

      for (const node of this.nodes) {
        if (node.type === 'peaking') {
          const width = node.frequency / node.Q;
          const response = 1 / (1 + Math.pow((frequency - node.frequency) / (width / 2), 2));
          totalGain += (response - 0.5) * 2 * node.gain;
        }
      }

      const y = this.gainToY(Math.max(-12, Math.min(12, totalGain)));
      if (firstPoint) { ctx.moveTo(x, y); firstPoint = false; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  private drawNodes() {
    const { ctx } = this;
    for (const node of this.nodes) {
      const x = this.frequencyToX(node.frequency);
      const y = this.gainToY(node.gain);
      const isSelected = this.selectedNodeId === node.id;

      ctx.fillStyle = node.color;
      ctx.globalAlpha = isSelected ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#FFFF00';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawAxisLabels() {
    const { ctx, padding, graphHeight } = this;
    ctx.fillStyle = '#888888';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    [{ freq: 20, label: '20' }, { freq: 100, label: '100' }, { freq: 1000, label: '1k' }, { freq: 10000, label: '10k' }]
      .forEach(({ freq, label }) => {
        ctx.fillText(label + ' Hz', this.frequencyToX(freq), graphHeight - 5);
      });

    ctx.textAlign = 'right';
    [-12, -6, 0, 6, 12].forEach((gain) => {
      ctx.fillText(gain + ' dB', padding - 10, this.gainToY(gain) + 4);
    });
  }

  private sendFilterUpdate(nodeId: number) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return;

    chrome.runtime.sendMessage({
      type: 'UPDATE_FILTER',
      nodeId: nodeId,
      config: {
        type: node.type,
        frequency: Math.round(node.frequency),
        Q: parseFloat(node.Q.toFixed(1)),
        gain: parseFloat(node.gain.toFixed(1))
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!msg.includes('Message port closed')) {
          console.error(`UPDATE_FILTER 에러 (nodeId=${nodeId}):`, msg);
        }
      }
    });
  }

  deleteSelectedNode() {
    if (this.selectedNodeId === null) return;
    this.removeNode(this.selectedNodeId);
  }

  reset() {
    const nodeIds = [...this.nodes.map(n => n.id)];
    nodeIds.forEach(id => this.removeNode(id));
    this.selectedNodeId = null;
    this.nextNodeId = 0;
    this.drawGraph();
  }

  getNodes(): EQNode[] {
    return this.nodes;
  }
}

// ============================================================
// UI 초기화 및 캡처 제어
// ============================================================

let visualizer: EQVisualizer;
let isCapturing = false;

function updateCaptureUI(capturing: boolean) {
  isCapturing = capturing;
  const btn = document.getElementById('captureButton') as HTMLButtonElement;
  const status = document.getElementById('captureStatus') as HTMLElement;

  if (!btn || !status) return;

  if (capturing) {
    btn.textContent = '🎤 오디오 캡처 중지';
    btn.classList.add('active');
    status.textContent = '캡처 중...';
    status.classList.add('active');
  } else {
    btn.textContent = '🎤 오디오 캡처 시작';
    btn.classList.remove('active');
    status.textContent = '대기 중';
    status.classList.remove('active');
  }
}

function startCapture() {
  if (isCapturing) return; // ★ 중복 방지

  chrome.runtime.sendMessage({ type: 'START_CAPTURE' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Popup] START_CAPTURE 오류:', chrome.runtime.lastError.message);
      updateCaptureUI(false);
      return;
    }
    if (response?.success) {
      console.log('[Popup] ✓ 오디오 캡처 시작 완료');
      updateCaptureUI(true);
    }
  });
}

function stopCapture() {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('[Popup] STOP_CAPTURE 응답:', chrome.runtime.lastError.message);
    }
    updateCaptureUI(false);
  });
}

function initializeUI() {
  visualizer = new EQVisualizer();

  // ★ FIX: 팝업 열림 시 자동 캡처 시작 + UI 상태 동기화
  console.log('[Popup] 팝업 로드 완료 → 자동 캡처 시작');
  startCapture();

  // 마스터 게인
  const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
  if (masterGainInput) {
    masterGainInput.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const display = document.getElementById('masterGainValue');
      if (display) display.textContent = value.toFixed(1) + ' dB';

      chrome.runtime.sendMessage({
        type: 'SET_MASTER_GAIN',
        gain: Math.pow(10, value / 20)
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Master gain error:', chrome.runtime.lastError.message);
        }
      });
    });
  }

  // 삭제 버튼
  const deleteBtn = document.getElementById('deleteButton');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => visualizer.deleteSelectedNode());
  }

  // ★ FIX: 캡처 토글 버튼 (startCapture/stopCapture 함수 사용)
  const captureBtn = document.getElementById('captureButton') as HTMLButtonElement;
  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      if (isCapturing) {
        stopCapture();
      } else {
        startCapture();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initializeUI);

window.addEventListener('unload', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
});

export {};
