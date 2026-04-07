## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - Hoisted Math in Canvas Drawing loops
Learning: Performing multiplications (like scaling) and addition (offset adjustments) on every data point in high-frequency rendering loops (like Canvas path generation) introduces measurable overhead. In `BufferVisualizer.tsx`, precalculating scale factors and hoisting base offsets out of the inner draw loop yields 15-20% execution time reductions during microbenchmarks. Also, when checking minimum drawing thresholds, comparing mathematical variance `(maxVal - minVal) * scale` is faster than applying rendering transforms and checking distance via `Math.abs(yMax - yMin)`.
Action: Identify loops iterating over hundreds of vertices in Canvas components and pre-calculate geometric transformations wherever inputs are loop-invariant.
