## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Eliminating GC overhead in method calls
Learning: When performance profiling shows that an object is frequently allocated via method returns in a high-frequency loop (like `getStateInfo` in `AudioSegmentProcessor`), replacing the return object with an optional `out` parameter object that mutates properties instead of allocating a new object can significantly reduce GC overhead. Extracting inline interfaces into reusable named types (like `VadState`) improves code clarity and enables the caching strategy.
Action: Whenever designing methods that are called repeatedly in a loop and return a complex object, use the `out` parameter pattern from the beginning to avoid subsequent refactoring for GC optimization.
