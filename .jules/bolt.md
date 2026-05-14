## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2023-10-27 - Canvas ImageData Loop Optimization
Learning: In high-frequency canvas rendering (like spectrograms), iterating `ImageData` columns-first (x, then y) causes cache thrashing because the underlying `Uint8ClampedArray` is 1D. Pre-calculating mappings and swapping loops to rows-first (y, then x) allows writing strictly sequentially `data[idx++]`, vastly improving memory throughput.
Action: When manually populating canvas `ImageData` pixel by pixel, always structure nested loops to write linearly to the 1D buffer.
