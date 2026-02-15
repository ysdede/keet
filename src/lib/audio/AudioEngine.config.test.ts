import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { AudioSegmentProcessor } from './AudioSegmentProcessor';

describe('AudioEngine config unit conversion', () => {
    it('converts ms durations to seconds before forwarding to AudioSegmentProcessor', () => {
        const minSpeechSpy = vi.spyOn(AudioSegmentProcessor.prototype, 'setMinSpeechDuration');
        const minSilenceSpy = vi.spyOn(AudioSegmentProcessor.prototype, 'setSilenceLength');

        const engine = new AudioEngine({
            minSpeechDuration: 240,
            minSilenceDuration: 400,
        });

        engine.updateConfig({
            minSpeechDuration: 320,
            minSilenceDuration: 560,
        });

        expect(minSpeechSpy).toHaveBeenCalledWith(0.32);
        expect(minSilenceSpy).toHaveBeenCalledWith(0.56);

        minSpeechSpy.mockRestore();
        minSilenceSpy.mockRestore();
    });
});
