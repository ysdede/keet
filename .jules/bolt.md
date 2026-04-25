## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2024-04-25 - Eliminate high-frequency object allocations in AudioEngine polling
Learning: The AudioEngine processes incoming microphone audio at high frequency (handleAudioChunk called continuously). Its internal pipeline retrieved metrics via `this.audioProcessor.getStats()` and `getStateInfo()`, which historically allocated and returned new object instances (and cloned properties) on every single call, causing massive main-thread GC churn (100k calls allocated ~117MB).
Action: Always refactor high-frequency getter methods in the main audio pipeline to accept pre-allocated `out` parameter objects instead of returning new ones.
