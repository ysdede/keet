## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-04-17 - AudioEngine loop optimization
Learning: Pulling out loop conditionals (e.g. static bounds calculations like `Math.floor`) into variables, along with stepping pointers rather than computing indexes based on iteration counters `i` from scratch per iteration, can lead to a 50% performance improvement in high-frequency functions.
Action: Apply loop hoisting and pointer arithmetic incrementing instead of continuous index re-evaluation in hot data loops.
