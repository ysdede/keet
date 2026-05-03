## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2024-05-03 - Reuse Float32Array in getBarLevels fallback
Learning: The getBarLevels method in AudioEngine allocates a new Float32Array on every call in its fallback path, causing GC churn during high-frequency UI polling.
Action: Cache and reuse a single Float32Array instance (barLevelsFallbackOut) for the fallback path, achieving a ~5.8x speedup by eliminating per-call allocations.

## 2024-05-03 - Reuse Float32Array in getBarLevels fallback
Learning: The getBarLevels method in AudioEngine allocates a new Float32Array on every call in its fallback path, causing GC churn during high-frequency UI polling. When returning a cached mutable object to SolidJS signals (like setBarLevels), the signal must be initialized with { equals: false } so that reference equality checks don't suppress UI updates.
Action: Cache and reuse a single Float32Array instance (barLevelsFallbackOut) for the fallback path, achieving a ~5.8x speedup by eliminating per-call allocations, and ensure the receiving signal disables reference equality.
