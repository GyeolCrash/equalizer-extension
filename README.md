# Audio Manipulator - Chrome Extension


## Tech Stack

### Runtime Build Environments

| Framework   | Version         | Purpose              |
|-------------|-----------------|----------------------|
| **Node.js** | 24.14.0 LTS     | JavaScript Runtime   |
| **npm**     | 10.x+           | Package Management   |
| **Vite**    | 7.3.1           | Multiple Entry Point |


### 개발 언어 및 타입 시스템

| 도구 | 버전 | 용도 |
|-------------------|--------|-------------------------------------------------|
| **TypeScript**    | 5.9.3  | Static Type Validation, Runtime Error Detection |
| **@types/chrome** | 0.1.37 | Chrome Extension API v3                         |


### Chrome Extension API

- **Manifest V3**
- **chrome.tabCapture API**
- **chrome.runtime API**
- **Offscreen API**

### Web Audio API

- **AudioContext**     
- **MediaStreamSource**
- **BiquadFilterNode**
- **AnalyserNode**    
- **GainNode**

## Directory

```
equalizer-extension/
├── src/
│   ├── manifest.json              # Manifest V3
│   ├── background.ts              # Background Service Worker
│   ├── offscreen.html             # Offscreen Document (Web Audio API Host)
│   ├── offscreen.ts               # Audio Logic
│   └── popup/
│       ├── popup.html             # User Interface
│       ├── popup.ts               # UI Event and Viusalization
│       └── popup.css              
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## How to Run

### 1. Install Node.js 

```bash
node --version  # v24.14.0 than latest
npm --version   # 10.x than latest
```

### 2. Install Depedencies

```bash
cd \your_directory\equalizer-extension
npm install
```

### 3. Build Production

```bash
npm run build
```

Build file will be created in `dist/` 

## Details

### Build and Bundling Settings

**rollup settings of vite.config.ts**:
```typescript
input: {
  popup: 'src/popup/popup.html',      // → dist/popup.js
  offscreen: 'src/offscreen.html',    // → dist/offscreen.js
  background: 'src/background.ts'     // → dist/background.js
}
output: {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js' 
}
```

**manifest.json path mapping**:
- `"service_worker": "background.js"` → dist/background.js
- `"default_popup": "src/popup/popup.html"` → dist/src/popup/popup.html
- `"document": "src/offscreen.html"` → dist/src/offscreen.html

```json
"offscreen_documents": [
  {
    "document": "src/offscreen.html",
    "matches": ["<all_urls>"],
    "reasons": ["AUDIO_PLAYBACK"]  // Explictly 
  }
]
```

**Permission Requirements**:
- `tabCapture`: Audio stream cpature
- `activeTab`: Access control of activted tab
- `scripting`: 
- `<all_urls>`:
- `storage`: Save environment settings
