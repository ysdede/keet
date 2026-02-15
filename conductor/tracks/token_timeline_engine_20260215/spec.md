# Specification: Token-Level Timeline Engine Optimization

## Goal
Stabilize and optimize the TokenTimelineEngine and LocalAgreementMerger to provide a robust foundation for real-time transcription with high visual stability and low latency.

## Requirements
- Ensure TokenTimelineEngine correctly handles out-of-order or overlapping token streams from the worker.
- Refine LocalAgreementMerger logic to minimize "flicker" while maintaining real-time responsiveness.
- Integrate the optimized engine into the main TranscriptionService and ppStore.
- Verify performance (RTF) and accuracy (WER) improvements.

## Success Criteria
- Zero regressions in existing transcription flow.
- Reduced UI jitter during token streaming.
- Passing unit tests for TokenTimelineEngine and LocalAgreementMerger.
