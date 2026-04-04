## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - O(1) Running Sum for High-Frequency VAD Energy
Learning: `AudioSegmentProcessor` was accumulating energy values per-chunk into arrays (`speechEnergies` and `silenceEnergies`), then calculating averages using `.reduce()`. This array manipulation inside an 80ms hot-path created continuous memory allocations and GC pressure.
Action: In streaming loops, use running totals (e.g. `sum` and `count` properties) rather than storing arrays of primitive values for average calculations. This makes the computation O(1) and zero-allocation.