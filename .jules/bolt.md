## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-18 - Canvas Pixel Manipulation
Learning: In high-frequency `ImageData` manipulation (e.g. `LayeredBufferVisualizer`), writing to the 1D pixel buffer sequentially (by swapping `for x` / `for y` to `for y` / `for x`) dramatically improves cache locality. Combined with typed array coordinate mappings, it cut render time nearly in half.
Action: Whenever doing per-pixel math across an entire canvas or image buffer in nested loops, prioritize iterating linearly across the target 1D array.
