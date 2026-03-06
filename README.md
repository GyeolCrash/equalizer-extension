# Pro-Q Equalizer Chrome Extension

파라메트릭 이퀄라이저 Chrome 확장 프로그램입니다. **Pro-Q**와 같은 DSP 음향 장비처럼 특정 주파수 영역을 세밀하게 제어하여 웹 브라우저의 모든 오디오 스트림에 실시간으로 이퀄라이제이션을 적용합니다.

## 주요 기능

- 🎚️ **5-밴드 파라메트릭 이퀄라이저**: 100Hz, 500Hz, 1kHz, 4kHz, 8kHz 대역 제어
- 📊 **실시간 주파수 스펙트럼 시각화**: FFT 기반의 인터랙티브 주파수 그래프
- 🎯 **세밀한 주파수 제어**: 
  - 게인(Gain): -12dB ~ +12dB
  - Q (대역폭): 0.1 ~ 10.0
  - 주파수: 20Hz ~ 20kHz
  - 필터 타입: Peaking, Low Shelf, High Shelf, Low Pass, High Pass
- 🔊 **마스터 게인 컨트롤**: 전체 볼륨 조정
- 🎨 **직관적인 UI**: 그래디언트 디자인과 실시간 피드백

## 기술 스택

### 런타임 및 빌드 환경

| 도구 | 버전 | 용도 |
|------|------|------|
| **Node.js** | 24.14.0 LTS | JavaScript 런타임 환경 |
| **npm** | 10.x+ | 패키지 관리 및 스크립트 실행 |
| **Vite** | 7.3.1 | 모듈 번들러 및 개발 서버 |

### 개발 언어 및 타입 시스템

| 도구 | 버전 | 용도 |
|------|------|------|
| **TypeScript** | 5.3.3+ | 정적 타입 검증 및 코드 품질 관리 |
| **@types/chrome** | 0.1.37 | Chrome Extension API 타입 정의 |

### Chrome Extension API

- **Manifest V3**: 최신 Chrome 확장 프로그램 표준
- **chrome.tabCapture API**: 탭 오디오 스트림 캡처
- **chrome.runtime API**: 확장 프로그램 컴포넌트 간 메시지 전송
- **Offscreen API**: DOM 제약 환경에서 Web Audio API 실행

### Web Audio API

| 컴포넌트 | 용도 |
|---------|------|
| **AudioContext** | 오디오 신호 처리 컨텍스트 |
| **MediaStreamSource** | 웹 오디오 입력 소스 |
| **BiquadFilterNode** | 주파수 대역 필터링 (밴드 EQ) |
| **AnalyserNode** | FFT 기반 주파수 데이터 추출 |
| **GainNode** | 음량 증폭 및 감쇠 |

## 프로젝트 구조

```
equalizer-extension/
├── src/
│   ├── manifest.json              # Manifest V3 설정
│   ├── background.ts              # Background Service Worker
│   ├── offscreen.html             # Offscreen Document (Web Audio API 호스트)
│   ├── offscreen.ts               # 오디오 처리 로직 (필터 체인)
│   └── popup/
│       ├── popup.html             # 사용자 인터페이스
│       ├── popup.ts               # UI 이벤트 및 시각화 로직
│       └── popup.css              # 스타일
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 설치 및 개발 환경 설정

### 1. Node.js 설치

최신 LTS 버전의 Node.js를 설치합니다.

```bash
# Node.js 설치 확인
node --version  # v24.14.0 이상
npm --version   # 10.x 이상
```

### 2. 프로젝트 의존성 설치

```bash
cd d:\equalizer-extension
npm install
```

### 3. 개발 서버 실행 (선택사항)

```bash
npm run dev
```

### 4. 프로덕션 빌드

```bash
npm run build
```

빌드된 파일은 `dist/` 디렉토리에 생성됩니다.

## Chrome에 확장 프로그램 설치

### 개발 모드 로드

1. Chrome 주소창에 `chrome://extensions/` 입력
2. **개발자 모드** 토글 활성화
3. **압축 해제된 확장 프로그램 로드** 클릭
4. `dist/` 또는 `src/` 디렉토리 선택

### 확장 프로그램 사용

1. 임의의 웹 페이지에서 음악 재생
2. Chrome 툴바의 **Pro-Q Equalizer** 아이콘 클릭
3. **오디오 캡처 시작** 버튼 클릭
4. 주파수 대역별 게인, Q, 타입을 조정하여 음質 커스터마이징

## 기술 상세 설명

### 오디오 캡처 및 라우팅

**chrome.tabCapture API** 호출로 현재 탭의 MediaStream 객체를 추출하고, Web Audio API의 **createMediaStreamSource** 메서드를 통해 오디오 컨텍스트에 연결합니다.

Manifest V3 환경의 백그라운드 서비스 워커는 DOM에 접근할 수 없으므로, **Offscreen API**를 활용하여 AudioContext의 생명주기를 관리하고 오디오 처리를 안정적으로 수행합니다.

### 필터 체인 구성

5개의 **BiquadFilterNode**를 직렬로 연결하여 구현된 필터 체인:

```
MediaStreamSource → Filter[0] → Filter[1] → Filter[2] → Filter[3] → Filter[4] → GainNode → AnalyserNode → Destination
```

각 필터는 다음 매개변수로 제어됩니다:

- **type**: Peaking(선택적 부스트/컷), Low/High Shelf(저/고주파 기울기), Low/High Pass(대역 필터링)
- **frequency**: 중심 주파수 (20Hz ~ 20kHz)
- **Q**: 대역폭 결정 (높을수록 좁은 대역)
- **gain**: 증폭(-12dB) 또는 감쇠(+12dB)

### 주파수 스펙트럼 시각화

**AnalyserNode**에서 FFT(Fast Fourier Transform) 기반의 주파수 데이터 추출:

```typescript
analyserNode.fftSize = 2048;  // 2048포인트 FFT
const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
analyserNode.getByteFrequencyData(frequencyData);
```

HTML5 Canvas API를 통해 매 프레임마다 주파수 스펙트럼을 렌더링하고, 최종 처리된 오디오 신호는 **AudioContext.destination**으로 연결되어 스피커를 통해 출력됩니다.

### Chrome 메시지 프로토콜

확장 프로그램의 각 컴포넌트는 **chrome.runtime.sendMessage** API를 통해 비동기 메시지를 송수신합니다:

| 메시지 타입 | 송신처 | 수신처 | 용도 |
|----------|--------|--------|------|
| `SETUP_AUDIO` | Popup | Offscreen | MediaStream 연결 |
| `UPDATE_FILTER` | Popup | Offscreen | 필터 파라미터 변경 |
| `GET_FREQUENCY_DATA` | Popup | Offscreen | 주파수 데이터 요청 |
| `SET_MASTER_GAIN` | Popup | Offscreen | 마스터 게인 설정 |
| `GET_STATUS` | Popup | Offscreen | 현재 필터 상태 조회 |

## 브라우저 호환성

- **Chrome/Chromium**: 88+
- **Edge**: 88+
- **Opera**: 74+

Manifest V3 지원이 필수적입니다.

## 개발 가이드

### 새로운 필터 추가

[offscreen.ts](src/offscreen.ts)의 `createFilterChain` 메서드 수정:

```typescript
private createFilterChain(count: number) {
  const frequencies = [100, 250, 500, 1000, 4000, 8000, 12000]; // 새 주파수 추가
  // ...
}
```

### UI 레이아웃 커스터마이징

[popup.css](src/popup/popup.css)의 그리드/플렉스 레이아웃 조정

### TypeScript 타입 검증

```bash
npx tsc --noEmit
```

## 라이센스

MIT

## 참고 자료

- [Chrome Extension API Documentation](https://developer.chrome.com/docs/extensions/)
- [Web Audio API Specification](https://www.w3.org/TR/webaudio/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Vite Documentation](https://vitejs.dev/)
