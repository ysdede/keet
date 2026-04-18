## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - Optimized Array Reduction in High-Frequency Audio Pipeline
Learning: In high-frequency data processing loops (like calculating average energy per audio chunk), accumulating state in an array and repeatedly calling `.reduce()` introduces significant Garbage Collection overhead and scales linearly O(N).
Action: Replace arrays used solely for averaging with O(1) running sum and count primitives (`sum`, `count`) to eliminate GC churn and improve calculation performance.
