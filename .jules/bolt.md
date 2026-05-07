## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2025-05-18 - Canvas Data Locality
Learning: Rendering log-mel spectrograms to a Canvas `ImageData` buffer suffers massive cache misses if written out-of-order (e.g. iterating by time, then frequency). Pre-computing bounds and swapping to outer-Y, inner-X loop order ensures perfectly sequential array writes, eliminating cache thrashing.
Action: Always structure 1D array loops to write linearly (`data[idx++]`) rather than jumping by strides when updating pixel buffers.
