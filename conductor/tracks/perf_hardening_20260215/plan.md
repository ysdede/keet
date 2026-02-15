# Implementation Plan: Performance Hardening

## Phase 1: Profiling and Resource Analysis
- [ ] Task: Profile the current v4 pipeline using Chrome DevTools.
    - [ ] Identify hot functions in TranscriptionWorker and BufferWorker.
    - [ ] Perform a memory allocation profile to identify GC hotspots.
- [ ] Task: Audit Main Thread work.
    - [ ] Measure impact of ppStore updates on UI frame budget.
    - [ ] Review LayeredBufferVisualizer and Waveform rendering efficiency.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Profiling and Resource Analysis' (Protocol in workflow.md)

## Phase 2: Core Optimization
- [ ] Task: Optimize hot paths in Workers.
    - [ ] Implement object pooling or reuse for frequently allocated objects.
    - [ ] Refine UtteranceBasedMerger logic for computational efficiency.
- [ ] Task: Optimize Data Transfer.
    - [ ] Ensure all large buffers use Transferable or SharedArrayBuffer where appropriate.
    - [ ] Batch UI updates from the TranscriptionService to reduce store churn.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Core Optimization' (Protocol in workflow.md)

## Phase 3: Validation and Hardening
- [ ] Task: Verify 60fps UI stability.
    - [ ] Use the Performance Monitor to confirm zero dropped frames during transcription.
- [ ] Task: Validate CPU/Memory gains.
    - [ ] Compare resource utilization before and after optimizations.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Validation and Hardening' (Protocol in workflow.md)
