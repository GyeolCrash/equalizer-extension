/**
 * Graph-based Audio Equalizer - Pro-Q 스타일 UI
 * 더블클릭으로 노드 추가, 좌클릭으로 선택, 텍스트 입력으로 값 편집
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
    // 더블클릭 - 새 노드 추가
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.isInGraphArea(x, y)) {
        this.addNode(x, y);
      }
    });

    // 좌클릭 - 노드 선택
    this.canvas.addEventListener('click', (e) => {
      if ((e as any).detail !== 1) return; // 더블클릭 제외
      
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const node = this.getNodeAtPosition(x, y);
      if (node) {
        this.selectNode(node.id);
      }
    });

    // 우클릭 - 노드 제거
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

    // 키보드 - Delete로 선택된 노드 제거
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
    this.sendFilterUpdate(id);
    this.updateNodeList();
    this.drawGraph();
  }

  removeNode(nodeId: number) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index === -1 || this.nodes.length <= 1) return;

    this.nodes.splice(index, 1);

    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = this.nodes.length > 0 ? this.nodes[0].id : null;
    }

    chrome.runtime.sendMessage({
      type: 'REMOVE_FILTER',
      nodeId: nodeId
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Remove filter error:', chrome.runtime.lastError.message);
      }
    });

    this.updateNodeList();
    this.updateControlPanel();
    this.drawGraph();
  }

  selectNode(nodeId: number) {
    this.selectedNodeId = nodeId;
    this.updateControlPanel();
    this.drawGraph();
  }

  private updateControlPanel() {
    const panel = document.getElementById('controlPanel') as HTMLDivElement;
    if (!panel || this.selectedNodeId === null) {
      panel.innerHTML = '<p>노드를 선택하세요</p>';
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

    // 이벤트 바인딩
    const freqInput = document.getElementById('freqInput') as HTMLInputElement;
    const qInput = document.getElementById('qInput') as HTMLInputElement;
    const gainInput = document.getElementById('gainInput') as HTMLInputElement;
    const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;

    freqInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        if (node) {
          node.frequency = parseFloat(freqInput.value);
          this.sendFilterUpdate(node.id);
          this.drawGraph();
        }
      }
    });

    qInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        if (node) {
          node.Q = parseFloat(qInput.value);
          this.sendFilterUpdate(node.id);
          this.drawGraph();
        }
      }
    });

    gainInput.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        if (node) {
          node.gain = parseFloat(gainInput.value);
          this.sendFilterUpdate(node.id);
          this.drawGraph();
        }
      }
    });

    filterSelect.addEventListener('change', () => {
      if (this.selectedNodeId !== null) {
        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        if (node) {
          node.type = filterSelect.value as BiquadFilterType;
          this.sendFilterUpdate(node.id);
          this.drawGraph();
        }
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
      if (distance <= hitRadius) {
        return node;
      }
    }
    return null;
  }

  private frequencyToX(frequency: number): number {
    const logFreq = Math.log10(Math.max(20, frequency));
    const logMin = Math.log10(20);
    const logMax = Math.log10(this.frequency10kHz);
    const normalized = (logFreq - logMin) / (logMax - logMin);
    return this.padding + normalized * (this.graphWidth - 2 * this.padding);
  }

  private xToFrequency(x: number): number {
    const normalized = (x - this.padding) / (this.graphWidth - 2 * this.padding);
    const logMin = Math.log10(20);
    const logMax = Math.log10(this.frequency10kHz);
    const logFreq = logMin + normalized * (logMax - logMin);
    return Math.pow(10, logFreq);
  }

  private gainToY(gain: number): number {
    const normalized = (gain + 12) / 24;
    return this.graphHeight - this.padding - normalized * (this.graphHeight - 2 * this.padding);
  }

  private yToGain(y: number): number {
    const normalized = (this.graphHeight - this.padding - y) / (this.graphHeight - 2 * this.padding);
    return normalized * 24 - 12;
  }

  private startVisualization() {
    if (this.isVisualizationRunning) return;
    this.isVisualizationRunning = true;

    const updateLoop = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_FREQUENCY_DATA' },
        (response) => {
          if (chrome.runtime.lastError) {
            return;
          }
          if (response && response.frequencyData) {
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
      const x = padding + i * barWidth;
      const y = graphHeight - padding - barHeight;

      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  private drawGridLines() {
    const { ctx, padding, graphWidth, graphHeight } = this;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;

    const frequencies = [20, 100, 500, 1000, 5000, 10000];
    frequencies.forEach((freq) => {
      const x = this.frequencyToX(freq);
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, graphHeight - padding);
      ctx.stroke();
    });

    const gains = [-12, -6, 0, 6, 12];
    gains.forEach((gain) => {
      const y = this.gainToY(gain);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(graphWidth - padding, y);
      ctx.stroke();
    });

    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    const centerY = this.gainToY(0);
    ctx.beginPath();
    ctx.moveTo(padding, centerY);
    ctx.lineTo(graphWidth - padding, centerY);
    ctx.stroke();
  }

  private drawFilterCurve() {
    const { ctx, padding, graphWidth, graphHeight } = this;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (let x = padding; x < graphWidth - padding; x += 2) {
      const frequency = this.xToFrequency(x);
      let totalGain = 0;

      for (const node of this.nodes) {
        const deltaF = frequency - node.frequency;
        const Q = node.Q;
        
        if (node.type === 'peaking') {
          const width = node.frequency / Q;
          const response = 1 / (1 + Math.pow(deltaF / (width / 2), 2));
          totalGain += (response - 0.5) * 2 * node.gain;
        }
      }

      const y = this.gainToY(Math.max(-12, Math.min(12, totalGain)));

      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
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
    const { ctx, padding, graphWidth, graphHeight } = this;

    ctx.fillStyle = '#888888';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    const freqLabels = [
      { freq: 20, label: '20' },
      { freq: 100, label: '100' },
      { freq: 1000, label: '1k' },
      { freq: 10000, label: '10k' }
    ];

    freqLabels.forEach(({ freq, label }) => {
      const x = this.frequencyToX(freq);
      ctx.fillText(label + ' Hz', x, graphHeight - 5);
    });

    ctx.textAlign = 'right';
    const gains = [-12, -6, 0, 6, 12];
    gains.forEach((gain) => {
      const y = this.gainToY(gain);
      ctx.fillText(gain + ' dB', padding - 10, y + 4);
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
        console.error('Update filter error:', chrome.runtime.lastError.message);
      }
    });
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

let visualizer: EQVisualizer;

function initializeUI() {
  visualizer = new EQVisualizer();

  // 마스터 게인
  const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
  if (masterGainInput) {
    masterGainInput.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const display = document.getElementById('masterGainValue');
      if (display) {
        display.textContent = value.toFixed(1) + ' dB';
      }

      chrome.runtime.sendMessage({
        type: 'SET_MASTER_GAIN',
        gain: Math.pow(10, value / 20)
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Master gain error:', chrome.runtime.lastError.message);
        }
      });
    });
  }

  // 초기화 버튼
  const resetBtn = document.getElementById('resetButton');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      visualizer.reset();
    });
  }
}

document.addEventListener('DOMContentLoaded', initializeUI);

export {};
