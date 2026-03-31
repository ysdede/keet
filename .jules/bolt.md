## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-03-31 - Zero-allocation metrics polling
Learning: Refactoring high-frequency metrics getters (`getStats` and `getStateInfo`) in `AudioSegmentProcessor` to accept an optional pre-allocated `out` object parameter effectively eliminated garbage collection overhead per audio chunk without breaking API contracts for standard consumers.
Action: Apply this zero-allocation "pass object to be mutated" pattern to other performance-critical loops spanning class boundaries.
