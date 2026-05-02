## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2026-02-18 - Pointer Incrementing in Hot Loops
Learning: Re-computing flat-array coordinates per pixel via multiplication (e.g. `idx = (pos + x) * stride`) in highly repetitive inner loops (like canvas data rendering at 30fps) introduces significant overhead. Replacing per-iteration arithmetic with a sequential pointer increment (`idx += stride`) improved performance by ~25% (saving ~300ms per 100k invocations).
Action: Prefer continuous linear scanning via pointer incrementing over calculating relative index positions when flattening data in high-frequency nested loops.
