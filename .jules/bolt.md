## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2024-05-30 - O(1) Running Sums for Audio Energy Tracking
Learning: High-frequency processing loops tracking historical segment statistics (like `speechEnergies` and `silenceEnergies` in `AudioSegmentProcessor`) cause continuous GC churn and CPU overhead when using dynamically growing arrays and `.reduce()` for final calculations.
Action: Next time a hot-path stream needs to track an average value over an indeterminate segment length, implement an O(1) running sum and count rather than buffering values in an array, provided individual history points aren't needed.
