## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Speculative Refactoring (Rejected)
Learning: Refactoring `.map().filter()` to `.reduce()` inside network request handlers (`fetchModelRevisions`, `fetchModelFiles`) in UI components is a useless micro-optimization that trades readability for negligible gains, and violates the "No speculative optimizations" constraint. It also risks introducing subtle bugs (e.g. filtering out falsy values before vs after normalization).
Action: Avoid speculative micro-optimizations in non-critical paths, particularly those dominated by network I/O or other latency-heavy operations. Always ensure the optimization targets a real, measured bottleneck.
