## 2025-02-28 - Optimize array iteration via running sum in VAD
Learning: In high-frequency or long-running audio processing paths, accumulating large arrays and using `.reduce()` for simple averages causes measurable CPU overhead (up to ~50-100ms in extreme cases for `speechEnergies` over long segments).
Action: Prefer keeping a running sum and count state variables (e.g., `speechEnergySum`, `speechEnergyCount`) rather than iterating accumulated arrays when simple statistical measures are needed.
