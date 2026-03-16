## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - AudioEngine O(1) Energy Sum Optimization
Learning: Functional array methods like `.reduce()` in very high-frequency loops (e.g., `handleAudioChunk` audio processing) introduce unnecessary closure allocations and CPU overhead, which can be entirely eliminated by keeping an O(1) running sum.
Action: For sliding windows and SMAs in hot paths, refactor to track running totals (adding incoming and subtracting shifted values) rather than iterating array elements per frame.
