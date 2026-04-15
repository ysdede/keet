## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2025-05-19 - Hoisting Inner Loop Calculations in Hot Paths
Learning: In high-frequency visualizer loops (e.g., `LayeredBufferVisualizer.tsx`), redundant evaluation of values that depend solely on outer loop boundaries (such as `Math.max(1, Math.floor((endIdx - startIdx) / 10))`) incurs significant CPU overhead per iteration. Hoisting this calculation to the outer loop eliminated this overhead.
Action: Always evaluate whether values calculated in inner loops depend only on outer loop indices/bounds, and hoist them whenever possible, especially in high-frequency functions or drawing routines.
