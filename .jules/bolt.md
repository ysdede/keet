## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2024-05-14 - Optimize array accumulation to running sums in high-frequency streams
Learning: Using arrays to accumulate energies (`speechEnergies.push(energy)`) during audio processing frames and then calculating the average with `.reduce()` causes significant GC overhead and O(N) iteration in VAD hot paths.
Action: Use O(1) running accumulators (`sum` and `count` variables) instead of tracking arrays to calculate stream averages.
