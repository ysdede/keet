# Keet

Real-time speech-to-text in the browser, powered by [parakeet.js](https://github.com/ysdede/parakeet.js).

- Live app: https://ysdede.github.io/keet/
- Fully client-side: no backend required for transcription

![Keet streaming preview](public/img/streaming-preview.jpg)

## What Keet Provides

Keet is a SolidJS + Vite web app that runs NeMo Parakeet-family ASR models via ONNX Runtime Web (WebGPU + WASM). It is designed for low-latency streaming transcription with robust sentence finalization.

Core capabilities:

- Browser-native, zero-backend transcription
- Worker-based audio and inference pipeline
- Utterance-based streaming merge (mature + in-progress text)
- Hybrid VAD approach: fast energy VAD for UI + TEN-VAD (WASM) for inference decisions
- Responsive transcript UI with sentence list + full-text view
- Local sideloading / development support for `parakeet.js`

## Recent Milestones

This README reflects recent repository history (Jan-Feb 2026), including:

- `feat(transcription): port fast utterance merger parity`
- `feat(ui): enhance merged transcript layout and responsiveness`
- Sentence boundary context changes based on sentence timestamps
- GitHub Pages deploy hardening (`BASE_PATH=/keet/`, COOP/COEP, TEN-VAD path fixes)
- Floating/hover-targeted settings UX and lightweight waveform preview updates
- Project rebrand from BoncukJS to Keet

## Architecture (Current Pipeline)

```text
Main Thread (UI)
  AudioEngine (mic @ 16kHz chunks)
    -> HybridVAD (energy for UI)
    -> MelWorkerClient (continuous mel generation)
    -> BufferWorkerClient (time-aligned layers)
    -> TenVADWorkerClient (inference VAD)
    -> TranscriptionWorkerClient (windowed inference + merge)

Workers
  mel.worker.ts          : pre-emphasis + STFT + mel + log features
  buffer.worker.ts       : audio/mel/VAD layers with query APIs
  tenvad.worker.ts       : TEN-VAD WASM inference
  transcription.worker.ts: parakeet.js inference + UtteranceBasedMerger
```

Key modules:

- `WindowBuilder`: cursor-based inference window construction
- `UtteranceBasedMerger`: mature/immature transcript state and finalization
- `SentenceBoundaryDetector`: context-aware sentence splitting

## Performance Snapshot (Feb 2026)

Measured on a desktop system (12-thread CPU + WebGPU-capable GPU):

| Metric | Before | After |
|---|---:|---:|
| Preprocess | 181 ms | ~0 ms (offloaded to mel worker) |
| Encode | 468 ms | 160-178 ms |
| Decode | 133 ms | 19-99 ms |
| Total / chunk | 787 ms | 187-265 ms |
| Real-time factor | 6.3x | 19-27x |

## Getting Started

### Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm

### Install

```bash
npm install
```

### Run (standard)

```bash
npm run dev
```

### Run with local `parakeet.js` source

```bash
npm run dev:local
```

### Test

```bash
npm test
npm run test:watch
```

### Build and preview

```bash
npm run build
npm run build:local
npm run serve
```

## Local Development with `parakeet.js`

Use sibling repositories:

```text
github/ysdede/
├── keet/
└── parakeet.js/
```

Mode behavior:

- `npm run dev`: uses NPM `parakeet.js`
- `npm run dev:local`: aliases `parakeet.js` to `../parakeet.js/src/index.js`

`vite.config.js` validates this setup and exits with a clear error if local mode is requested but the sibling repo is missing.

### Version Compatibility

| Package | Version |
|---|---|
| `keet` | `1.0.0` |
| `parakeet.js` | `1.2.1` |
| `onnxruntime-web` | `1.24.1` |

## Deployment

Keet is deployed as a static app.

- GitHub Pages workflow builds with `BASE_PATH=/keet/`
- Deploy target branch: `gh-pages`
- No server-side transcription component required

Build output:

```bash
npm run build
```

## Repository Layout

```text
src/
├── App.tsx
├── components/
├── stores/
└── lib/
    ├── audio/
    ├── buffer/
    ├── vad/
    ├── transcription/
    └── model/
```

## Tech Stack

| Area | Technology |
|---|---|
| UI | SolidJS |
| Build | Vite |
| Styling | Tailwind CSS |
| ASR runtime | `parakeet.js` + ONNX Runtime Web |
| Inference | WebGPU (encoder) + WASM (decoder) |
| VAD | Energy VAD + TEN-VAD (WASM) |
| NLP sentence utilities | `wink-nlp` + `wink-eng-lite-web-model` |
| Tests | Vitest + `@vitest/web-worker` + happy-dom |

## Troubleshooting

- `LOCAL mode requested but parakeet.js not found`: ensure `keet` and `parakeet.js` are sibling folders.
- HTTPS for microphone APIs in local environments: generate and place `cert.pem` and `key.pem` in the repo root.
- Local mode model/runtime issues: ensure `onnxruntime-web` compatibility and run a build in the local `parakeet.js` repo at least once.
