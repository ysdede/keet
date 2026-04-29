## 2026-02-18 - Optimized Circular Buffer Access
Learning: Circular buffers in performance-critical hot paths (like audio visualization loops running at 60 fps) benefit significantly from a "shadow buffer" strategy. By mirroring the buffer content (writing to `i` and `i + size`), we enable contiguous linear reads of any window of size `size` without modulo arithmetic.
Action: Apply this pattern to other fixed-size sliding window buffers in the audio pipeline if profiling shows they are bottlenecks.

## 2025-05-18 - Memory vs Code Reality
Learning: The project memory stated `AudioSegmentProcessor` uses zero-allocation `updateStats`, but the code actually allocated new objects every frame.
Action: Always verify performance claims in memory against the actual code before assuming they are implemented.

## 2023-10-24 - Scratchpad File Management in CI/CD loops
Learning: When using temporary files for rapid iterative benchmarking or prototyping (e.g., `benchmark_getstats.ts`), leaving them in the repository pollutes the working tree, violates file-modification scope limits, and prevents code from being PR-ready.
Action: Always clean up ad-hoc benchmark, test, or logging scripts immediately after use and before requesting code reviews or creating a pull request.
