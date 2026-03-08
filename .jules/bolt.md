## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-03-05 - Avoid chained array operations in hot loops
Learning: Chaining `.map().filter()` or `.filter().map()` creates intermediate arrays, causing unnecessary allocations and garbage collection overhead. In high-frequency functions or tight UI update loops (like those in `SettingsPanel.tsx` and `UtteranceBasedMerger.ts`), single-pass `.reduce()` significantly improves performance by avoiding the intermediate allocations (benchmarked at ~3-4x faster for typical small arrays).
Action: Refactor array chains to single-pass `.reduce()` where performance is critical.
