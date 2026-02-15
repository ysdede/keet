# Implementation Plan: Performance Hardening

## Phase 1: Profiling and Resource Analysis
- [x] Task: Profile the current v4 pipeline using Chrome DevTools.
    - [x] Identify hot functions in TranscriptionWorker and BufferWorker.
    - [x] Perform a memory allocation profile to identify GC hotspots.
- [x] Task: Audit Main Thread work.
    - [x] Measure impact of appStore updates on UI frame budget.
    - [x] Review LayeredBufferVisualizer and Waveform rendering efficiency.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Profiling and Resource Analysis' (Protocol in workflow.md)

## Phase 2: Core Optimization
- [x] Task: Optimize hot paths in Workers.
    - [x] Implement object pooling or reuse for frequently allocated objects.
    - [x] Refine UtteranceBasedMerger logic for computational efficiency.
- [x] Task: Optimize Data Transfer.
    - [x] Ensure all large buffers use Transferable or SharedArrayBuffer where appropriate.
    - [x] Batch UI updates from the TranscriptionService to reduce store churn.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Core Optimization' (Protocol in workflow.md)

## Phase 3: Validation and Hardening
- [x] Task: Verify 60fps UI stability.
    - [x] Use the Performance Monitor to confirm zero dropped frames during transcription.
- [x] Task: Validate CPU/Memory gains.
    - [x] Compare resource utilization before and after optimizations.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Validation and Hardening' (Protocol in workflow.md)
