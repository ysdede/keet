## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Use Sets for O(1) unsubscription in hot callback lists
Learning: When managing frequently updated callback lists (like in `AudioEngine`), using standard arrays and `.filter()` during unsubscription creates O(N) operations and allocates new array objects, triggering garbage collection.
Action: Refactor hot subscriber lists (e.g., `segmentCallbacks`, `visualizationCallbacks`) to use `Set`s, which provide O(1) `.delete()` unsubscription and eliminate GC churn without requiring changes to `.forEach` or `for...of` iteration syntax.
