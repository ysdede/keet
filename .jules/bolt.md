## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2024-05-19 - AudioEngine array index calculation hoisting
Learning: In high-frequency visualizer functions (like AudioEngine's `getVisualizationData()`), recalculating buffer indices within a loop using multiplication and modulo arithmetic creates a noticeable overhead. Strength reduction (incrementing a pointer `summaryIdx += 2`) and hoisting `Math.floor()` can reduce execution time by roughly 40%.
Action: When dealing with tight loops iterating over flat arrays for signal processing, prefer a sequentially incremented pointer variable over recalculating the array index inside the loop, and hoist any constant or bounds arithmetic outside.
