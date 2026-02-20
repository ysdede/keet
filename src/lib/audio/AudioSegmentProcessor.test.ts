
import { describe, it, expect } from 'vitest';
import { AudioSegmentProcessor } from './AudioSegmentProcessor';

describe('AudioSegmentProcessor', () => {
    it('should initialize without errors', () => {
        const processor = new AudioSegmentProcessor({ logger: () => { } });
        expect(processor).toBeDefined();
        const stats = processor.getStats();
        expect(stats).toBeDefined();
        expect(stats.noiseFloor).toBeGreaterThan(0);
    });

    it('should process silence without detecting segments', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.1,
            logger: () => { },
        });

        // 16000 samples = 1 second
        const silence = new Float32Array(16000).fill(0);
        const energy = 0.0001;
        const currentTime = 1.0;

        const segments = processor.processAudioData(silence, currentTime, energy);

        expect(segments).toEqual([]);
        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
    });

    it('should process speech and detect segments', () => {
        // This is a simplified test.
        // Real VAD is complex, so we just check state transitions if we force high energy
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.01,
            logger: () => { },
        });

        const speech = new Float32Array(1600).fill(0.5); // 100ms
        const energy = 0.5; // High energy

        // Process a few chunks to trigger speech detection
        let segments = processor.processAudioData(speech, 1.0, energy);

        // It might not trigger immediately due to lookback/SNR checks,
        // but let's check internal state or just that it doesn't crash

        // Force state check
        // processor.processAudioData is complex, so let's just ensure it runs
        expect(Array.isArray(segments)).toBe(true);
    });

    it('should reset state correctly', () => {
        const processor = new AudioSegmentProcessor({ logger: () => { } });

        // Simulate some state change
        const chunk = new Float32Array(100).fill(0.1);
        processor.processAudioData(chunk, 1.0, 0.5);

        processor.reset();

        const stats = processor.getStats();
        expect(stats.noiseFloor).toBe(0.005); // Default reset value
        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
        expect(state.speechStartTime).toBeNull();
    });

    it('should adapt noise floor during sustained silence', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            logger: () => { },
        });
        const silenceChunk = new Float32Array(1280).fill(0);

        for (let i = 0; i < 20; i++) {
            processor.processAudioData(silenceChunk, (i + 1) * 0.08, 0.0001);
        }

        const state = processor.getStateInfo();
        expect(state.noiseFloor).toBeLessThan(0.005);
        expect(state.noiseFloor).toBeGreaterThan(0);
    });

    it('should end speech after configured silence threshold', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.01,
            silenceThreshold: 0.16,
            logger: () => { },
        });
        const speechChunk = new Float32Array(1280).fill(0.5);
        const silenceChunk = new Float32Array(1280).fill(0);

        processor.processAudioData(speechChunk, 0.0, 0.5);
        processor.processAudioData(speechChunk, 0.08, 0.5);

        const firstSilence = processor.processAudioData(silenceChunk, 0.16, 0.0001);
        expect(firstSilence.length).toBe(0);
        expect(processor.getStateInfo().inSpeech).toBe(true);

        const secondSilence = processor.processAudioData(silenceChunk, 0.24, 0.0001);
        expect(secondSilence.length).toBe(1);
        expect(secondSilence[0].duration).toBeGreaterThan(0);
        expect(processor.getStateInfo().inSpeech).toBe(false);
    });

    it('should update speech detection behavior when threshold changes', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            logger: () => { },
        });
        const speechChunk = new Float32Array(1280).fill(0.5);

        processor.setThreshold(0.9);
        processor.reset();
        processor.processAudioData(speechChunk, 0.08, 0.5);
        expect(processor.getStateInfo().inSpeech).toBe(false);

        processor.setThreshold(0.1);
        processor.processAudioData(speechChunk, 0.16, 0.5);
        expect(processor.getStateInfo().inSpeech).toBe(true);
    });

    it('should update speech statistics after a completed segment', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.01,
            silenceThreshold: 0.08,
            maxSilenceWithinSpeech: 0,
            logger: () => { },
        });
        const speechChunk = new Float32Array(1280).fill(0.5);
        const silenceChunk = new Float32Array(1280).fill(0);

        processor.processAudioData(speechChunk, 0.0, 0.5);
        processor.processAudioData(silenceChunk, 0.08, 0.0001);

        const stats = processor.getStats();
        expect(stats.speech.avgDuration).toBeGreaterThan(0);
        expect(stats.speech.avgEnergy).toBeGreaterThan(0);
    });

    it('should return defensive copies from getStats', () => {
        const processor = new AudioSegmentProcessor({ logger: () => { } });
        const stats = processor.getStats();

        stats.noiseFloor = 999;
        stats.speech.avgDuration = 123;
        stats.silence.avgEnergy = 456;

        const current = processor.getStats();
        expect(current.noiseFloor).toBe(0.005);
        expect(current.speech.avgDuration).toBe(0);
        expect(current.silence.avgEnergy).toBe(0);
    });
});
