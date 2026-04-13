## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-04-13 - Hoisting Loop Bounds in Visualizers
Learning: In high-frequency visualizer loops (like `LayeredBufferVisualizer`), loop increment bounds that depend on loop-invariant variables (e.g. `Math.max(1, Math.floor((endIdx - startIdx) / 10))`) cause redundant mathematical operations and property lookups on every single iteration, severely degrading performance.
Action: Always hoist step size and bounds calculations that rely on outer-loop constants outside the inner loop.
