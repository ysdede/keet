## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - AudioSegmentProcessor Energy Tracking GC Churn
Learning: In high-frequency, continuous streams (like `AudioSegmentProcessor.processAudioData`), accumulating per-chunk metrics (like energy) into unbounded arrays (`speechEnergies`, `silenceEnergies`) to compute averages later causes significant O(N) memory growth and garbage collection churn, leaking MBs of memory in just a few minutes of audio.
Action: Always use O(1) running sums (`sum += value; count++`) instead of array accumulation and `.reduce()` for metrics that only require a final average.
