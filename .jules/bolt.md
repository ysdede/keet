## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2024-05-18 - Optimized getMatureText Caching
Learning: In high-frequency getters (e.g., `UtteranceBasedMerger.getMatureText()`), incrementally cache concatenated strings instead of dynamically mapping and joining array elements to prevent O(N^2) CPU overhead and garbage collection churn. The same was found to be true in our application, where `getMatureText()` took 20%+ of the total execution time during processing of long transcripts due to its re-evaluation for every returned context, especially `createResult`.
Action: Incrementally cache concatenations or apply a dirty flag when the underlying state updates instead of evaluating on demand.
