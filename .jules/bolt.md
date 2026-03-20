## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.
## 2025-05-28 - Test Dependency Network Access
Learning: Some tests like `mel-e2e.test.ts` attempt network requests to download fixtures from GitHub. In restricted environments where networking to external hosts fails or times out, these tests will fail or hang.
Action: Handle network timeouts gracefully or skip tests dynamically when external resources are unavailable, preventing environment issues from breaking the suite.
