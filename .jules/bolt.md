## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Pre-calculation & Memory Linearization in Canvas Rendering
Learning: In high-frequency, per-pixel canvas drawing loops (like spectrogram rendering), performing math bounds-checking and float-clamping inner loops is a bottleneck. Pre-calculating mappings (like frequency bin mapped to Y coordinate) and iterating arrays in memory-linear order (Y then X, writing linearly to the 1D ImageData array) reduces calculation overhead and improves cache locality, yielding ~30% faster renders.
Action: Always hoist geometry-to-data mapping calculations outside per-pixel loops, inline basic clamping logic, and write incrementally to flattened data arrays rather than computing exact offsets each iteration.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
