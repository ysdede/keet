# Specification: Clean up V5 Overhead and Optimize V4 Pipeline

## Goal
Reduce system overhead by removing/disabling V5 token-timeline logic and optimizing V4 utterance-based merger backend requests.

## Requirements
- **Optimize V4 Requests:** Modify 	ranscription.worker.ts to stop requesting eturnTokenIds, eturnFrameIndices, and eturnLogProbs for V4 modes.
- **Simplify Store:** Remove V5-related signals and logic from ppStore.ts.
- **Streamline UI:**
    - Remove V5 modes and metrics from DebugPanel.tsx.
    - Remove V5 correction settings from SettingsPanel.tsx.
    - Simplify TranscriptionDisplay.tsx to focus on V4 text flow.
- **Worker Cleanup:** Disable V5 message handlers in 	ranscription.worker.ts.

## Success Criteria
- V4 transcription remains fully functional and stable.
- Reduced data transfer between JS and WASM/GPU backend.
- Cleaner UI and reduced reactivity overhead in the main thread.
- Zero V5 code executing during active transcription.
