## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-10-24 - O(N^2) String Allocation in High-Frequency Getters
Learning: Calling `.map(w => w.text).join(' ')` inside `getMatureText()`—which is executed on every frame/UI tick—causes massive GC churn and exponential slowdowns as the transcription log grows.
Action: Always aggressively cache concatenated strings for large, growing text streams when they are accessed in tight loops or rendering cycles.