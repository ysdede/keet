## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-05-10 - Canvas Render Loop Optimization
Learning: When caching pixel coordinate mappings for canvas rendering in reactive UI components, cache invalidation logic must check dynamic data scale factors (e.g., `timeScale` or `timeSteps`) in addition to canvas dimensions, because data bounds frequently change without triggering a canvas resize.
Action: Always verify the full set of inputs that determine a cached value to prevent stale data bugs, especially in audio/visual pipelines where data lengths are dynamic.
