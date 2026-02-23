## 2024-05-23 - AudioSegmentProcessor Allocation Overhead
Learning: Ported legacy code (AudioSegmentProcessor) contained dead code (silenceStats) and expensive object allocation (updateStats) running at audio chunk rate (125Hz), even when consumers only needed primitive metrics available in internal state.
Action: When optimizing high-frequency loops (like audio processing), inspect 'ported' or 'legacy' modules for unused data structures and lazy-load expensive statistical objects instead of computing them eagerly.
