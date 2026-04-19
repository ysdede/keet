## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - Hoisting calculations in loops
Learning: In high-frequency data processing loops (e.g., audio downsampling in `AudioEngine.getVisualizationData`), avoid redundant offset and scale math by checking absolute value thresholds and hoisting calculations outside the inner loop. Computing pointer offsets once and incrementally updating them provides significant performance gains.
Action: Whenever reviewing array processing loops across windows or sub-segments, look for opportunities to hoist math expressions and array indexes out of inner loop conditions, replacing repeated computations with sequentially incremented pointers.
