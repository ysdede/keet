## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2024-05-23 - Array index optimization in hot visualization loop
Learning: In high-frequency data subsampling loops running frequently (like `AudioEngine.getVisualizationData`), pre-calculating array offsets by sequential pointer addition (e.g. `idx += 2`) and hoisting out Math.floor boundary calculations can result in substantial (>30%) performance improvements by avoiding redundant float-to-int operations and bound calculations.
Action: Next time processing inner loops in canvas visualization or audio sampling logic, hoist bounds outside and rely on simple loop accumulators for index tracing.
