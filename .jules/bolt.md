## 2025-02-19 - Allocation in High-Frequency Audio Loops
Learning: Frequent object allocation in `AudioSegmentProcessor.updateStats` (called every ~80ms or faster) creates significant GC pressure. Using `Object.assign` and mutation instead of spread/literal syntax reduced CPU time by ~3.4x in benchmarks.
Action: Prefer mutable state updates or zero-allocation patterns in audio processing hot paths (e.g., `processAudioData`, `handleAudioChunk`). Avoid `const x = { ...y }` inside loops running >10Hz.
