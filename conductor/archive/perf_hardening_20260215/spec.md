# Specification: Performance Hardening (v4 Pipeline)

## Goal
Optimize the v4 Utterance Merger pipeline to achieve lower CPU/Memory utilization and ensure maximum UI responsiveness (60fps) during real-time transcription.

## Requirements
- **CPU Optimization:** Identify and reduce heavy computational loops in TranscriptionWorker and BufferWorker.
- **Memory Management:** Minimize garbage collection (GC) pressure by reducing object allocations in the hot path of audio processing and token merging.
- **UI Responsiveness:** Ensure the main thread remains unblocked. Audit ppStore updates and component re-renders (Waveform, TranscriptionDisplay).
- **Worker Efficiency:** Optimize data transfer between workers using Transferable objects where possible to avoid expensive structured cloning.

## Success Criteria
- Significant reduction in average CPU usage during active transcription.
- Stable 60fps UI rendering during peak transcription load.
- Reduced frequency and duration of GC pauses.
- Passing regression tests for existing v4 pipeline functionality.
