## 2025-05-18 - Running sums in high-frequency loops
Learning: In performance-critical per-chunk processing loops like audio processing, using `.reduce()` for moving averages causes GC overhead and O(N) complexity per frame.
Action: Replace `.reduce()` and related iteration methods with O(1) running sums using persistent properties (e.g. `energySum`) to minimize GC churn and CPU overhead per tick.

## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
