## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2023-10-25 - Avoid array chains for reactive text composition
Learning: In reactive UI components that build final string outputs from large arrays of entries (e.g., long transcription histories), using `.map().filter().join()` creates intermediate array allocations on every render cycle. Replacing these with a manual `for` loop avoids these allocations.
Action: Prefer manual `for` loops or reducers when reducing large arrays of text snippets to a single string in reactive contexts.
