## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2024-03-24 - Zero-allocation VAD stats
Learning: In high-frequency audio chunk loops (~80ms chunks), `AudioSegmentProcessor.getStateInfo()` and `getStats()` allocated new objects on every call, causing measurable GC overhead and baseline slowdowns.
Action: Mutate and return cached class-level references instead of returning new objects for high-frequency getter methods, and read their primitive properties immediately in the caller.
