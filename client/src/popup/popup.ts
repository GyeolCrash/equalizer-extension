interface EQNode {
  id: number;
  frequency: number;
  Q: number;
  gain: number;
  type: BiquadFilterType;
  color: string;
}

class SubscriptionManager {
  private isPro: boolean = false;
  private retryCount = 0;
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000;
  private readonly GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000;
  private readonly SERVER_URL = 'http://localhost:3000/api';

  async initialize(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(['subscription', 'lastChecked'], async (res) => {
        const now = Date.now();
        const lastChecked = (res.lastChecked as number) || 0;
        const cachedSub = (res.subscription as string) || 'free';

        if (now - lastChecked < this.CACHE_TTL) {
          this.isPro = cachedSub === 'pro';
          resolve();
          return;
        }

        if (cachedSub === 'pro' && now - lastChecked < this.GRACE_PERIOD) {
          this.isPro = true;
          this.verifyWithBackoff();
          resolve();
        } else {
          this.isPro = false;
          await this.verifyWithBackoff();
          resolve();
        }
      });
    });
  }

  getIsPro(): boolean {
    return this.isPro;
  }

  private async verifyWithBackoff() {
    this.retryCount = 0;
    await this.attemptVerification();
  }

  private async attemptVerification() {
    try {
      const authResult = await chrome.identity.getAuthToken({ interactive: true });

      const token = authResult.token;

      if (!token) {
        throw new Error('Get token failed');
      }

      const response = await fetch(`${this.SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token })
      });

      if (!response.ok) throw new Error('API Error');

      const data = await response.json();
      const plan = data.user?.plan || 'free';

      this.isPro = plan === 'pro';
      chrome.storage.local.set({
        subscription: plan,
        lastChecked: Date.now()
      });
      this.hideBanner();
    } catch (e) {
      console.error(e);
      this.showBanner();
    }
  }

  private showBanner() {
    let banner = document.getElementById('subscription-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'subscription-banner';
      banner.style.display = 'flex';
      banner.style.backgroundColor = '#a04040';
      banner.style.color = 'white';
      banner.style.padding = '8px 16px';
      banner.style.alignItems = 'center';
      banner.style.justifyContent = 'space-between';
      banner.style.fontSize = '12px';

      const msg = document.createElement('span');
      msg.textContent = 'Subscription verification failed';
      msg.style.flex = '1';

      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.className = 'btn';
      retryBtn.style.padding = '4px 12px';
      retryBtn.style.fontSize = '11px';

      retryBtn.onclick = () => {
        this.retryCount++;
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying...';
        setTimeout(async () => {
          await this.attemptVerification();
          if (retryBtn) {
            retryBtn.disabled = false;
            retryBtn.textContent = 'Retry';
          }
        }, delay);
      };

      banner.appendChild(msg);
      banner.appendChild(retryBtn);

      const container = document.querySelector('.container');
      if (container) {
        container.insertBefore(banner, container.firstChild);
      } else {
        document.body.prepend(banner);
      }
    }
    banner.style.display = 'flex';
  }

  private hideBanner() {
    const banner = document.getElementById('subscription-banner');
    if (banner) banner.style.display = 'none';
  }
}

const subscriptionManager = new SubscriptionManager();

class UIManager {
  private pendingTheme: string = 'system';
  private pendingViewMode: string = 'popup';
  private currentViewMode: string = 'popup';

  constructor() {
    this.setupTabs();
    this.setupTheme();
    this.setupViewMode();
    this.setupApplyButton();
  }

  private setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.target as HTMLButtonElement;
        const targetId = targetBtn.dataset.target;

        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        targetBtn.classList.add('active');
        document.getElementById(targetId!)?.classList.add('active');
      });
    });
  }

  private setupTheme() {
    const themeBtns = document.querySelectorAll('#themeButtons .btn-toggle');

    chrome.storage.local.get(['theme'], (result) => {
      this.pendingTheme = (result.theme as string) || 'system';
      this.applyThemeLogic(this.pendingTheme);
      this.updateThemeButtons();
    });

    themeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.pendingTheme = (e.currentTarget as HTMLButtonElement).dataset.themeVal!;
        this.updateThemeButtons();
      });
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      chrome.storage.local.get(['theme'], (result) => {
        if (!result.theme || result.theme === 'system') {
          this.pendingTheme = 'system';
          this.applyThemeLogic('system');
        }
      });
    });
  }

  private updateThemeButtons() {
    const themeBtns = document.querySelectorAll('#themeButtons .btn-toggle');
    themeBtns.forEach(btn => {
      if ((btn as HTMLButtonElement).dataset.themeVal === this.pendingTheme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private applyThemeLogic(theme: string) {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    document.dispatchEvent(new Event('themeChanged'));
  }

  private setupViewMode() {
    const viewModeBtns = document.querySelectorAll('#viewModeButtons .btn-toggle');

    chrome.storage.local.get(['viewMode'], (result) => {
      this.currentViewMode = (result.viewMode as string) || 'popup';
      this.pendingViewMode = this.currentViewMode;
      this.updateViewModeButtons();
    });

    viewModeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.pendingViewMode = (e.currentTarget as HTMLButtonElement).dataset.modeVal!;
        this.updateViewModeButtons();
      });
    });
  }

  private updateViewModeButtons() {
    const viewModeBtns = document.querySelectorAll('#viewModeButtons .btn-toggle');
    viewModeBtns.forEach(btn => {
      if ((btn as HTMLButtonElement).dataset.modeVal === this.pendingViewMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private setupApplyButton() {
    const applyBtn = document.getElementById('applySettingsBtn');
    if (!applyBtn) return;

    applyBtn.addEventListener('click', () => {
      // 1. Theme application
      chrome.storage.local.set({ theme: this.pendingTheme });
      this.applyThemeLogic(this.pendingTheme);

      // 2. View Mode application
      if (this.pendingViewMode !== 'popup' && !subscriptionManager.getIsPro()) {
        alert('Pro Plan is required to use Side Panel or New Tab modes.');
        this.pendingViewMode = 'popup';
        this.updateViewModeButtons();
      }

      const modeChanged = this.pendingViewMode !== this.currentViewMode;
      this.currentViewMode = this.pendingViewMode;
      chrome.storage.local.set({ viewMode: this.pendingViewMode });

      if (this.pendingViewMode === 'sidePanel') {
        if ((chrome as any).sidePanel && (chrome as any).sidePanel.setPanelBehavior) {
          (chrome as any).sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
        }
      } else {
        if ((chrome as any).sidePanel && (chrome as any).sidePanel.setPanelBehavior) {
          (chrome as any).sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
        }
      }

      if (modeChanged) {
        if (this.pendingViewMode === 'sidePanel') {
          chrome.windows.getCurrent({ populate: false }, (win) => {
            if (win.id !== undefined && (chrome as any).sidePanel) {
              (chrome as any).sidePanel.open({ windowId: win.id }).then(() => {
                window.close();
              }).catch(() => { window.close(); });
            }
          });
        } else if (this.pendingViewMode === 'newTab') {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') }).then(() => {
            window.close();
          });
        } else {
          // Changed to Popup mode, close current window
          chrome.tabs.getCurrent((tab) => {
            if (tab && tab.id) {
              chrome.tabs.remove(tab.id);
            } else {
              window.close();
            }
          });
        }
      }
    });
  }
}

class EQVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: EQNode[] = [];
  private selectedNodeId: number | null = null;
  private draggingNode: EQNode | null = null;
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
          this.nodes = msg.data.filters.map((f: any) => ({
            id: f.nodeId, frequency: f.frequency, Q: f.Q, gain: f.gain, type: f.type,
            color: this.colorPalette[f.nodeId % this.colorPalette.length]
          }));
          this.nodes.sort((a, b) => a.id - b.id);
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
        this.addNode(x, y);
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

    document.addEventListener('themeChanged', () => {
      this.drawGraph();
    });
  }

  private isInGraphArea(x: number, y: number): boolean {
    return x >= this.padding && x <= this.graphWidth - this.padding &&
      y >= this.padding && y <= this.graphHeight - this.padding;
  }

  addNode(x: number, y: number) {
    const maxNodes = subscriptionManager.getIsPro() ? 20 : 5; // Cap at 20 for system stability
    if (this.nodes.length >= maxNodes) {
      if (!subscriptionManager.getIsPro() && this.nodes.length >= 5) {
        alert("Pro Plan is required to add more than 5 nodes.");
      }
      return;
    }

    let id = 0;
    while (this.nodes.some(n => n.id === id)) {
      id++;
    }

    const node: EQNode = {
      id, frequency: this.xToFrequency(x), Q: 1.0, gain: this.yToGain(y), type: 'peaking',
      color: this.colorPalette[id % this.colorPalette.length]
    };

    this.nodes.push(node);
    this.nodes.sort((a, b) => a.id - b.id);
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
      if (panel) panel.innerHTML = '<p class="placeholder-text">Select a node</p>';
      return;
    }

    const node = this.nodes.find(n => n.id === this.selectedNodeId);
    if (!node) return;

    panel.innerHTML = `
      <div class="node-title">Node ${node.id + 1}</div>
      <div class="info-group">
        <label>Freq</label>
        <input type="number" id="freqInput" value="${Math.round(node.frequency)}" min="20" max="20000" />
        <span>Hz</span>
      </div>
      <div class="info-group">
        <label>Gain</label>
        <input type="number" id="gainInput" value="${node.gain.toFixed(1)}" min="-12" max="12" step="0.1" />
        <span>dB</span>
      </div>
      <div class="info-group">
        <label>Q</label>
        <input type="number" id="qInput" value="${node.Q.toFixed(1)}" min="0.1" max="10" step="0.1" />
        <span></span>
      </div>
      <div class="info-group">
        <label>Filter</label>
        <select id="filterSelect">
          <option value="peaking" ${node.type === 'peaking' ? 'selected' : ''}>Peaking</option>
          <option value="lowshelf" ${node.type === 'lowshelf' ? 'selected' : ''}>LowShelf</option>
          <option value="highshelf" ${node.type === 'highshelf' ? 'selected' : ''}>HiShelf</option>
          <option value="lowpass" ${node.type === 'lowpass' ? 'selected' : ''}>LowPass</option>
          <option value="highpass" ${node.type === 'highpass' ? 'selected' : ''}>HiPass</option>
        </select>
        <span></span>
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
    this.nodes.forEach((node) => {
      const item = document.createElement('div');
      item.className = `node-item ${this.selectedNodeId === node.id ? 'selected' : ''}`;
      item.innerHTML = `<span>${node.id + 1}</span>`;
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
    const styles = getComputedStyle(document.documentElement);

    ctx.fillStyle = styles.getPropertyValue('--canvas-bg').trim() || '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.drawFrequencySpectrum();
    this.drawGridLines(styles);
    this.drawFilterCurve();
    this.drawNodes();
    this.drawAxisLabels(styles);
  }

  private drawFrequencySpectrum() {
    if (!this.frequencyData) return;
    const { ctx, padding, graphWidth, graphHeight } = this;
    const barWidth = (graphWidth - 2 * padding) / this.frequencyData.length;
    ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
    for (let i = 0; i < this.frequencyData.length; i++) {
      const barHeight = (this.frequencyData[i] / 255) * (graphHeight - 2 * padding);
      ctx.fillRect(padding + i * barWidth, graphHeight - padding - barHeight, barWidth, barHeight);
    }
  }

  private drawGridLines(styles: CSSStyleDeclaration) {
    const { ctx, padding, graphWidth, graphHeight } = this;
    ctx.strokeStyle = styles.getPropertyValue('--grid-line-1').trim() || '#2a2a2a';
    ctx.lineWidth = 1;
    [20, 100, 500, 1000, 5000, 10000].forEach((freq) => {
      const x = this.frequencyToX(freq);
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, graphHeight - padding); ctx.stroke();
    });
    [-12, -6, 0, 6, 12].forEach((gain) => {
      const y = this.gainToY(gain);
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(graphWidth - padding, y); ctx.stroke();
    });

    ctx.strokeStyle = styles.getPropertyValue('--grid-line-2').trim() || '#444444';
    ctx.lineWidth = 2;
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

    const styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = styles.getPropertyValue('--text-main').trim() || '#ffffff';
    ctx.lineWidth = 2; ctx.beginPath();
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

  private drawAxisLabels(styles: CSSStyleDeclaration) {
    const { ctx, padding, graphHeight } = this;
    ctx.fillStyle = styles.getPropertyValue('--text-dark').trim() || '#777777';
    ctx.font = '11px Arial'; ctx.textAlign = 'center';
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

document.addEventListener('DOMContentLoaded', async () => {
  await subscriptionManager.initialize();
  new UIManager();
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

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    chrome.runtime.reload();
  });
});

export { };