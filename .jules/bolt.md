## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Nested Object Assignment in Hot Paths
Learning: When optimizing high-frequency loops returning nested object states (like `Stats.silence` and `Stats.speech`), shallow spreading (`{ ...stats }`) allocates new top-level and nested objects. Using an `out` parameter with `Object.assign(out.nested, source.nested)` completely eliminates these per-frame allocations, dropping execution time and GC pressure to zero.
Action: Implement pooling and `out` parameters using deep property assignment for nested structures returned in visualization and audio processing hot paths.
