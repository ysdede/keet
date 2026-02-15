# Technology Stack

## Core Frontend
- **Framework:** SolidJS (v1.9+) - Leverages fine-grained reactivity for high-performance UI updates.
- **Language:** TypeScript (v5.7+) - Ensures type safety across the complex audio processing pipeline.
- **Styling:** Tailwind CSS (v4+) - Modern utility-first CSS for a minimalist and responsive design.

## Build & Tooling
- **Build Tool:** Vite (v6+) - Optimized development and build pipeline for modern web apps.
- **Testing:** Vitest (v4+) - Unit and integration testing for core logic and workers.

## AI & Audio Engine
- **Transcription:** Parakeet.js (v1.2.1) - NVIDIA NeMo Parakeet TDT models running in-browser.
- **Inference Runtime:** onnxruntime-web (v1.24.1) - WebGPU and WASM execution of ONNX models.
- **VAD (Voice Activity Detection):** TEN-VAD (WASM) and Hybrid energy-based VAD.
- **NLP:** wink-nlp - Browser-optimized NLP for sentence boundary detection and finalization.

## Architecture
- **Multi-Threading:** Extensive use of Web Workers (BufferWorker, TranscriptionWorker, TenVADWorker) to keep the main thread idle for UI rendering.
- **Zero-Copy Buffering:** Optimized audio data handling via RingBuffer and shared arrays where possible to minimize GC pressure.
