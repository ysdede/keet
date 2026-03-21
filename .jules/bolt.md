## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-03-21 - SettingsPanel Array Processing Optimization
Learning: Chained `.map().filter()` operations on API response arrays (like branches and files) cause significant Garbage Collection (GC) overhead due to intermediate array allocations. Refactoring to a single `.reduce()` pass improves parsing time by ~3x in environments handling large payloads.
Action: Prefer `.reduce()` or single-pass `for` loops over chained array methods for critical parsing paths to minimize allocations.
