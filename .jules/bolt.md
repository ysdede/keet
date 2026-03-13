## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-03-13 - O(N) Array Iteration in High-Frequency Audio Path
Learning: `AudioEngine.handleAudioChunk` was using `Array.prototype.reduce()` to calculate an SMA for every incoming chunk. Converting this to maintain an O(1) running `energySum` property avoids repetitive iteration and high-frequency GC pressure in the hottest path.
Action: Prefer running sums or circular variables instead of recreating/iterating arrays sequentially in per-chunk processing loops.
