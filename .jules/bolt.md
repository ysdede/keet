## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2026-04-12 - AudioEngine Set Optimization
Learning: Subscriber lists in `AudioEngine` (like `segmentCallbacks`, `windowCallbacks`, `audioChunkCallbacks`, and `visualizationCallbacks`) were using arrays with `.filter()` for unsubscriptions, creating unnecessary O(n) array reallocation and GC churn on every component unmount. Replacing these arrays with `Set`s provides O(1) unsubscription via `.delete()` and eliminates garbage collection overhead while safely preserving insertion order and iteration semantics.
Action: Default to using `Set`s for event listener/callback collections, especially in components with frequent mount/unmount lifecycles.
