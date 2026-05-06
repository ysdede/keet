## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2026-05-06 - Audio Segment Energy Arrays
Learning: The `AudioSegmentProcessor` code was accumulating per-chunk audio energies in `speechEnergies` and `silenceEnergies` arrays and repeatedly calculating averages using `.reduce()`, which caused unnecessary GC churn and CPU overhead in a high-frequency (12.5Hz - 100Hz) hot path.
Action: Replace growing arrays with primitive O(1) running sums and counts (`speechEnergySum`, `speechEnergyCount`) for metrics that only require simple aggregation.
