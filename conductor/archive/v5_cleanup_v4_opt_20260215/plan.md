# Implementation Plan: V5 Cleanup and V4 Optimization

## Phase 1: Worker Optimization [checkpoint: 4e66f2e]
- [x] Task: Optimize V4 transcribe options. 4e66f2e
    - [x] Update PROCESS_V4_CHUNK_WITH_FEATURES in 	ranscription.worker.ts to use minimal options. 4e66f2e
- [x] Task: Disable V5 worker logic. 4e66f2e
    - [x] Comment out or remove V5 message handlers and related helper functions in 	ranscription.worker.ts. 4e66f2e
- [x] Task: Conductor - User Manual Verification 'Phase 1: Worker Optimization' (Protocol in workflow.md) 4e66f2e

## Phase 2: UI and Store Cleanup [checkpoint: 2559c20]
- [x] Task: Clean up ppStore.ts. 2559c20
    - [x] Remove V5 signals, types, and reset logic. 2559c20
- [x] Task: Streamline UI Components. 2559c20
    - [x] Remove V5 references in DebugPanel.tsx. 2559c20
    - [x] Remove V5 settings in SettingsPanel.tsx. 2559c20
    - [x] Refactor TranscriptionDisplay.tsx to remove token-based coloring and V5 paths. 2559c20
    - [x] Clean up V5 mode logic in App.tsx. 2559c20
- [x] Task: Conductor - User Manual Verification 'Phase 2: UI and Store Cleanup' (Protocol in workflow.md) 2559c20

## Phase 3: Final Validation
- [x] Task: End-to-end V4 verification. 2559c20
    - [x] Ensure utterance merging and sentence finalization work as expected. 2559c20
- [x] Task: Conductor - User Manual Verification 'Phase 3: Final Validation' (Protocol in workflow.md) 2559c20