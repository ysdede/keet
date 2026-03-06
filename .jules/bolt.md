## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Getter GC Overhead Optimization
Learning: Returning a new object from a frequently called getter like `getStateInfo` (called 60 times a second per VAD step) introduces unnecessary GC churn. However, directly returning a shared, mutable internal object reference introduces subtle aliasing bugs that violate predictable API behavior.
Action: To safely avoid GC overhead without breaking the API contract, implement the "optional out parameter" pattern (e.g., `getStateInfo(out?: StateInfo)`). This pattern allows callers in high-frequency hot paths to supply a cached object for mutation while preserving immutable defaults for standard usage.
