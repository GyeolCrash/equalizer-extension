/**
 * Popup UI 관리 및 사용자 인터페이스
 * 필터 제어 및 주파수 스펙트럼 시각화
 */

interface FilterState {
  index: number;
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

class PopupUI {
  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private animationId: number | null = null;
  private filters: FilterState[] = [];

  constructor() {
    this.initializeUI();
    this.setupEventListeners();
  }

  private initializeUI() {
    // Canvas 초기화
    this.canvas = document.getElementById('frequencyCanvas') as HTMLCanvasElement;
    if (this.canvas) {
      this.canvasCtx = this.canvas.getContext('2d');
      this.resizeCanvas();
    }

    // 초기 필터 UI 생성
    this.createFilterUI();
  }

  private resizeCanvas() {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;

    if (this.canvasCtx) {
      this.canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  }

  private createFilterUI() {
    const filterGroup = document.getElementById('filterGroup');
    if (!filterGroup) return;

    filterGroup.innerHTML = '';

    // 5개 필터 UI 생성
    for (let i = 0; i < 5; i++) {
      const frequencies = [100, 500, 1000, 4000, 8000];
      const filterDiv = this.createFilterElement(i, frequencies[i]);
      filterGroup.appendChild(filterDiv);
    }
  }

  private createFilterElement(index: number, frequency: number): HTMLElement {
    const div = document.createElement('div');
    div.className = 'filter-item';

    div.innerHTML = `
      <h3>필터 ${index + 1} (${frequency} Hz)</h3>

      <div class="filter-param">
        <label>게인 (Gain)</label>
        <input type="range" class="gain-control" data-filter="${index}" min="-12" max="12" value="0" step="0.1" />
        <span><span class="gain-value">0</span> dB</span>
      </div>

      <div class="filter-param">
        <label>Q (대역폭)</label>
        <input type="range" class="q-control" data-filter="${index}" min="0.1" max="10" value="1" step="0.1" />
        <span id="q-value-${index}">1</span>
      </div>

      <div class="filter-param">
        <label>주파수</label>
        <input type="range" class="freq-control" data-filter="${index}" min="20" max="20000" value="${frequency}" step="10" />
        <span><span class="freq-value">${frequency}</span> Hz</span>
      </div>

      <div class="filter-param">
        <label>타입</label>
        <select class="type-control" data-filter="${index}">
          <option value="peaking">Peaking</option>
          <option value="lowshelf">Low Shelf</option>
          <option value="highshelf">High Shelf</option>
          <option value="lowpass">Low Pass</option>
          <option value="highpass">High Pass</option>
        </select>
      </div>
    `;

    return div;
  }

  private setupEventListeners() {
    // 마스터 게인
    const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
    if (masterGainInput) {
      masterGainInput.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        const gainValue = document.getElementById('gainValue');
        if (gainValue) gainValue.textContent = `${value.toFixed(1)} dB`;

        chrome.runtime.sendMessage({
          type: 'SET_MASTER_GAIN',
          gain: Math.pow(10, value / 20) // dB to linear gain
        });
      });
    }

    // 필터 제어
    document.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;

      if (target.classList.contains('gain-control')) {
        const filterIndex = parseInt(target.dataset.filter || '0');
        const value = parseFloat(target.value);
        const display = target.parentElement?.querySelector('.gain-value');
        if (display) display.textContent = value.toFixed(1);

        chrome.runtime.sendMessage({
          type: 'UPDATE_FILTER',
          filterIndex,
          config: { gain: value }
        });
      }

      if (target.classList.contains('q-control')) {
        const filterIndex = parseInt(target.dataset.filter || '0');
        const value = parseFloat(target.value);
        const display = document.getElementById(`q-value-${filterIndex}`);
        if (display) display.textContent = value.toFixed(1);

        chrome.runtime.sendMessage({
          type: 'UPDATE_FILTER',
          filterIndex,
          config: { Q: value }
        });
      }

      if (target.classList.contains('freq-control')) {
        const filterIndex = parseInt(target.dataset.filter || '0');
        const value = parseFloat(target.value);
        const display = target.parentElement?.querySelector('.freq-value');
        if (display) display.textContent = value.toFixed(0);

        chrome.runtime.sendMessage({
          type: 'UPDATE_FILTER',
          filterIndex,
          config: { frequency: value }
        });
      }
    });

    // Select 변경 이벤트
    document.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;

      if (target.classList.contains('type-control')) {
        const filterIndex = parseInt(target.dataset.filter || '0');
        const value = target.value as BiquadFilterType;

        chrome.runtime.sendMessage({
          type: 'UPDATE_FILTER',
          filterIndex,
          config: { type: value }
        });
      }
    });

    // 캡처 버튼
    const captureButton = document.getElementById('captureButton');
    if (captureButton) {
      captureButton.addEventListener('click', async () => {
        try {
          const tab = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab[0]?.id) {
            chrome.tabCapture.capture(
              { audio: true, video: false },
              (stream) => {
                if (chrome.runtime.lastError) {
                  console.error('오디오 캡처 실패:', chrome.runtime.lastError);
                  return;
                }

                // Offscreen Document로 스트림 전달
                chrome.runtime.sendMessage({
                  type: 'SETUP_AUDIO',
                  stream: stream
                });

                captureButton.textContent = '캡처 중지';
                captureButton.classList.add('capturing');
                this.startVisualization();
              }
            );
          }
        } catch (error) {
          console.error('캡처 요청 실패:', error);
        }
      });
    }

    // 초기화 버튼
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        this.resetFilters();
      });
    }
  }

  private startVisualization() {
    const draw = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_FREQUENCY_DATA' },
        (response) => {
          if (response?.data) {
            this.drawFrequencyBars(new Uint8Array(response.data));
          }
          this.animationId = requestAnimationFrame(draw);
        }
      );
    };

    draw();
  }

  private drawFrequencyBars(dataArray: Uint8Array) {
    if (!this.canvas || !this.canvasCtx) return;

    const width = this.canvas.width / window.devicePixelRatio;
    const height = this.canvas.height / window.devicePixelRatio;
    const barCount = 64;
    const barWidth = width / barCount;

    // 배경
    this.canvasCtx.fillStyle = '#1a1a1a';
    this.canvasCtx.fillRect(0, 0, width, height);

    // 그리드 라인
    this.canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.canvasCtx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      this.canvasCtx.beginPath();
      this.canvasCtx.moveTo(0, y);
      this.canvasCtx.lineTo(width, y);
      this.canvasCtx.stroke();
    }

    // 주파수 바 그리기
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * dataArray.length);
      const value = dataArray[dataIndex] / 255;

      const x = i * barWidth;
      const barHeight = value * height;
      const y = height - barHeight;

      // 그래디언트
      const gradient = this.canvasCtx.createLinearGradient(0, y, 0, height);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');

      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(x, y, barWidth - 2, barHeight);
    }
  }

  private resetFilters() {
    // 모든 필터 게인을 0으로 초기화
    for (let i = 0; i < 5; i++) {
      const gainInput = document.querySelector(
        `.gain-control[data-filter="${i}"]`
      ) as HTMLInputElement;
      if (gainInput) {
        gainInput.value = '0';
        gainInput.dispatchEvent(new Event('input'));
      }
    }

    // 마스터 게인 초기화
    const masterGainInput = document.getElementById('masterGain') as HTMLInputElement;
    if (masterGainInput) {
      masterGainInput.value = '0';
      masterGainInput.dispatchEvent(new Event('input'));
    }
  }
}

// Popup 초기화
document.addEventListener('DOMContentLoaded', () => {
  new PopupUI();
});

export {};
