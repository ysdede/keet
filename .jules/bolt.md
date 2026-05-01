## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-05-01 - Object Pooling Pitfalls with Nested References
Learning: When implementing object pooling (e.g., via `out` parameters to prevent GC churn), a naive `Object.assign(out, state)` will shallow-copy nested object references, leaking internal component state to the caller and breaking encapsulation.
Action: Always manually map primitive properties and explicitly `Object.assign` onto the pre-allocated nested objects of the `out` parameter to preserve zero-allocation while maintaining encapsulation.
