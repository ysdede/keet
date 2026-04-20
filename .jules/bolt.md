## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - High-frequency Loop Optimization
Learning: In high-frequency rendering loops such as `LayeredBufferVisualizer`, calculations that only depend on outer bounds (like `Math.max(1, Math.floor((endIdx - startIdx) / 10))`) and mapping arrays (like `Math.floor((height - 1 - y) * freqScale)`) can cause significant CPU overhead when recomputed per pixel.
Action: Always hoist invariant logic out of inner loops and inline mathematical normalization constants to eliminate per-iteration function calls and divisions.
