## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2024-04-24 - O(1) Running sums in hot paths
Learning: In high-frequency, per-chunk audio processing loops (like `AudioSegmentProcessor`), accumulating statistics in arrays to later run `.reduce()` is significantly slower and generates excessive garbage collection pressure.
Action: Next time, replace array accumulations in tight streaming loops with O(1) running sum integer/float properties (e.g., `sum` and `count`) to eliminate array reallocation and loop processing overhead.
