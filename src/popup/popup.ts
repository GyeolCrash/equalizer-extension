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
  private uiAudioContext: AudioContext;
  private backgroundPort: chrome.runtime.Port;

  private graphWidth = 800;
  private graphHeight = 250;
  private padding = 40;
  private frequency10kHz = 10000;
  private colorPalette = ['#FF4444', '#44FF44', '#4444FF', '#FFD700', '#FF00FF', '#00FFFF', '#FFA500', '#00FF00', '#FF6699', '#FFFF00'];

  constructor() {
    this.canvas = document.getElementById('eqGraph') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.uiAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.backgroundPort = chrome.runtime.connect({ name: 'popup-port' });

    this.setupPortListener();
    this.setupEventListeners();
    this.backgroundPort.postMessage({ type: 'GET_STATUS' });
    this.startVisualization();
    this.drawGraph();
  }

  private setupPortListener() {
    this.backgroundPort.onMessage.addListener((msg) => {
      if (msg.type === 'SYNC_STATUS' && msg.data) {
        if (msg.data.filters) {
          this.nodes = msg.data.filters.map((f: any, i: number) => ({
            id: f.nodeId, frequency: f.frequency, Q: f.Q, gain: f.gain, type: f.type,
            color: this.colorPalette[i % this.colorPalette.length]
          }));
          this.nextNodeId = this.nodes.length > 0 ? Math.max(...this.nodes.map(n => n.id)) + 1 : 0;
          this.updateNodeList();
          this.updateControlPanel();
          this.drawGraph();
        }
        
        if (msg.data.masterGain !== undefined) {
          const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
          const display = document.getElementById('masterGainValue');
          if (masterGainInput && display) {
            const dbValue = 20 * Math.log10(msg.data.masterGain || 1);
            masterGainInput.value = dbValue.toFixed(1);
            display.textContent = dbValue.toFixed(1) + ' dB';
          }
        }
      } else if (msg.type === 'SYNC_FREQUENCY_DATA' && msg.data) {
        this.frequencyData = new Uint8Array(msg.data);
      }
    });
  }

  private getCanvasCoordinates(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  private setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { x, y } = this.getCanvasCoordinates(e);
      const node = this.getNodeAtPosition(x, y);

      if (node) {
        this.selectNode(node.id);
        this.draggingNode = node;
      } else {
        this.selectedNodeId = null;
        this.updateControlPanel();
        this.updateNodeList();
        this.drawGraph();
      }
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const { x, y } = this.getCanvasCoordinates(e);
      if (!this.getNodeAtPosition(x, y) && this.isInGraphArea(x, y)) {
        if (this.nodes.length < 5) this.addNode(x, y);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.draggingNode) return;
      const { x, y } = this.getCanvasCoordinates(e);
      if (this.isInGraphArea(x, y)) {
        this.draggingNode.frequency = Math.max(20, Math.min(20000, this.xToFrequency(x)));
        this.draggingNode.gain = Math.max(-12, Math.min(12, this.yToGain(y)));
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
      const { x, y } = this.getCanvasCoordinates(e);
      const node = this.getNodeAtPosition(x, y);
      if (node) this.removeNode(node.id);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.selectedNodeId !== null) {
        this.removeNode(this.selectedNodeId);
      }
    });
  }

  private isInGraphArea(x: number, y: number): boolean {
    return x >= this.padding && x <= this.graphWidth - this.padding &&
           y >= this.padding && y <= this.graphHeight - this.padding;
  }

  addNode(x: number, y: number) {
    const id = this.nextNodeId++;
    const node: EQNode = {
      id, frequency: this.xToFrequency(x), Q: 1.0, gain: this.yToGain(y), type: 'peaking',
      color: this.colorPalette[this.nodes.length % this.colorPalette.length]
    };
    this.nodes.push(node);
    this.selectNode(id);
    this.backgroundPort.postMessage({ type: 'ADD_FILTER', nodeId: id, frequency: Math.round(node.frequency) });
    this.sendFilterUpdate(id);
    this.updateNodeList();
    this.drawGraph();
  }

  removeNode(nodeId: number) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index === -1) return;
    this.nodes.splice(index, 1);
    if (this.selectedNodeId === nodeId) this.selectedNodeId = null;
    this.backgroundPort.postMessage({ type: 'REMOVE_FILTER', nodeId: nodeId });
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
      <div class="info-group"><label>Node ${node.id + 1}</label></div>
      <div class="info-group"><label>Frequency:</label><input type="number" id="freqInput" value="${Math.round(node.frequency)}" min="20" max="20000" /><span>Hz</span></div>
      <div class="info-group"><label>Q:</label><input type="number" id="qInput" value="${node.Q.toFixed(1)}" min="0.1" max="10" step="0.1" /></div>
      <div class="info-group"><label>Gain:</label><input type="number" id="gainInput" value="${node.gain.toFixed(1)}" min="-12" max="12" step="0.1" /><span>dB</span></div>
      <div class="info-group"><label>Filter:</label>
        <select id="filterSelect">
          <option value="peaking" ${node.type === 'peaking' ? 'selected' : ''}>Peaking</option>
          <option value="lowshelf" ${node.type === 'lowshelf' ? 'selected' : ''}>Low Shelf</option>
          <option value="highshelf" ${node.type === 'highshelf' ? 'selected' : ''}>High Shelf</option>
          <option value="lowpass" ${node.type === 'lowpass' ? 'selected' : ''}>Low Pass</option>
          <option value="highpass" ${node.type === 'highpass' ? 'selected' : ''}>High Pass</option>
        </select>
      </div>
    `;

    document.getElementById('freqInput')?.addEventListener('change', (e) => { node.frequency = parseFloat((e.target as HTMLInputElement).value); this.sendFilterUpdate(node.id); this.drawGraph(); });
    document.getElementById('qInput')?.addEventListener('change', (e) => { node.Q = parseFloat((e.target as HTMLInputElement).value); this.sendFilterUpdate(node.id); this.drawGraph(); });
    document.getElementById('gainInput')?.addEventListener('change', (e) => { node.gain = parseFloat((e.target as HTMLInputElement).value); this.sendFilterUpdate(node.id); this.drawGraph(); });
    document.getElementById('filterSelect')?.addEventListener('change', (e) => { node.type = (e.target as HTMLSelectElement).value as BiquadFilterType; this.sendFilterUpdate(node.id); this.drawGraph(); });
  }

  private updateNodeList() {
    const listContainer = document.getElementById('nodeList') as HTMLDivElement;
    if (!listContainer) return;
    listContainer.innerHTML = '';
    this.nodes.forEach((node, index) => {
      const item = document.createElement('div');
      item.className = `node-item ${this.selectedNodeId === node.id ? 'selected' : ''}`;
      item.innerHTML = `<span>${index + 1}</span>`;
      item.addEventListener('click', () => this.selectNode(node.id));
      listContainer.appendChild(item);
    });
  }

  private getNodeAtPosition(x: number, y: number): EQNode | null {
    const hitRadius = 25;
    for (const node of this.nodes) {
      const nodeX = this.frequencyToX(node.frequency);
      const nodeY = this.gainToY(node.gain);
      if (Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2) <= hitRadius) return node;
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
      this.backgroundPort.postMessage({ type: 'GET_FREQUENCY_DATA' });
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
    const barWidth = (graphWidth - 2 * padding) / this.frequencyData.length;
    ctx.fillStyle = 'rgba(100, 200, 255, 0.1)';
    for (let i = 0; i < this.frequencyData.length; i++) {
      const barHeight = (this.frequencyData[i] / 255) * (graphHeight - 2 * padding);
      ctx.fillRect(padding + i * barWidth, graphHeight - padding - barHeight, barWidth, barHeight);
    }
  }

  private drawGridLines() {
    const { ctx, padding, graphWidth, graphHeight } = this;
    ctx.strokeStyle = '#333333'; ctx.lineWidth = 1;
    [20, 100, 500, 1000, 5000, 10000].forEach((freq) => {
      const x = this.frequencyToX(freq);
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, graphHeight - padding); ctx.stroke();
    });
    [-12, -6, 0, 6, 12].forEach((gain) => {
      const y = this.gainToY(gain);
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(graphWidth - padding, y); ctx.stroke();
    });
    ctx.strokeStyle = '#555555'; ctx.lineWidth = 2;
    const centerY = this.gainToY(0);
    ctx.beginPath(); ctx.moveTo(padding, centerY); ctx.lineTo(graphWidth - padding, centerY); ctx.stroke();
  }

  private drawFilterCurve() {
    const { ctx, padding, graphWidth } = this;
    const numPoints = graphWidth - 2 * padding;
    const freqs = new Float32Array(numPoints);
    const totalMag = new Float32Array(numPoints);
    totalMag.fill(1.0);

    for (let i = 0; i < numPoints; i++) freqs[i] = this.xToFrequency(padding + i);

    for (const node of this.nodes) {
      const tempFilter = this.uiAudioContext.createBiquadFilter();
      tempFilter.type = node.type;
      tempFilter.frequency.value = node.frequency;
      tempFilter.Q.value = node.Q;
      tempFilter.gain.value = node.gain;

      const magResponse = new Float32Array(numPoints);
      const phaseResponse = new Float32Array(numPoints);
      tempFilter.getFrequencyResponse(freqs, magResponse, phaseResponse);

      for (let i = 0; i < numPoints; i++) totalMag[i] *= magResponse[i];
    }

    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const x = padding + i;
      const gainDb = 20 * Math.log10(totalMag[i]);
      const y = this.gainToY(Math.max(-12, Math.min(12, gainDb)));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();

      if (isSelected) { ctx.strokeStyle = '#FFFF00'; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawAxisLabels() {
    const { ctx, padding, graphHeight } = this;
    ctx.fillStyle = '#888888'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
    [{ freq: 20, label: '20' }, { freq: 100, label: '100' }, { freq: 1000, label: '1k' }, { freq: 10000, label: '10k' }]
      .forEach(({ freq, label }) => { ctx.fillText(label + ' Hz', this.frequencyToX(freq), graphHeight - 5); });
    ctx.textAlign = 'right';
    [-12, -6, 0, 6, 12].forEach((gain) => { ctx.fillText(gain + ' dB', padding - 10, this.gainToY(gain) + 4); });
  }

  private sendFilterUpdate(nodeId: number) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return;
    this.backgroundPort.postMessage({
      type: 'UPDATE_FILTER', nodeId: nodeId,
      config: { type: node.type, frequency: Math.round(node.frequency), Q: parseFloat(node.Q.toFixed(1)), gain: parseFloat(node.gain.toFixed(1)) }
    });
  }

  deleteSelectedNode() { if (this.selectedNodeId !== null) this.removeNode(this.selectedNodeId); }
  
  reset() { 
    [...this.nodes.map(n => n.id)].forEach(id => this.removeNode(id));
    this.sendMasterGain(1.0);
    const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
    const display = document.getElementById('masterGainValue');
    if (masterGainInput && display) {
      masterGainInput.value = "0";
      display.textContent = "0.0 dB";
    }
  }
  
  startCaptureCommand() { this.backgroundPort.postMessage({ type: 'START_CAPTURE' }); }
  sendMasterGain(gain: number) { this.backgroundPort.postMessage({ type: 'SET_MASTER_GAIN', gain }); }
}

document.addEventListener('DOMContentLoaded', () => {
  const visualizer = new EQVisualizer();
  
  visualizer.startCaptureCommand();

  const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
  if (masterGainInput) {
    masterGainInput.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const display = document.getElementById('masterGainValue');
      if (display) display.textContent = value.toFixed(1) + ' dB';
      visualizer.sendMasterGain(Math.pow(10, value / 20));
    });
  }

  document.getElementById('deleteButton')?.addEventListener('click', () => visualizer.deleteSelectedNode());
  document.getElementById('resetButton')?.addEventListener('click', () => visualizer.reset());
});

export {};