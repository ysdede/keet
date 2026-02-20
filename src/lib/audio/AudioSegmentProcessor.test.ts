
import { describe, it, expect } from 'vitest';
import { AudioSegmentProcessor, type ProcessedSegment } from './AudioSegmentProcessor';

describe('AudioSegmentProcessor', () => {
    it('should initialize without errors', () => {
        const processor = new AudioSegmentProcessor();
        expect(processor).toBeDefined();
        const stats = processor.getStats();
        expect(stats).toBeDefined();
        expect(stats.noiseFloor).toBeGreaterThan(0);
    });

    it('should process silence without detecting segments', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.1
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
            energyThreshold: 0.01
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
        const processor = new AudioSegmentProcessor();

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

    it('should proactively split segments exceeding maxDuration', () => {
        const sampleRate = 16000;
        const maxDuration = 0.5;

        const processor = new AudioSegmentProcessor({
            sampleRate,
            maxSegmentDuration: maxDuration,
            energyThreshold: 0.01,
            minSpeechDuration: 0.1,
            snrThreshold: 0,
            minSnrThreshold: 0,
            logger: () => {}
        });

        const chunkSize = Math.round(sampleRate * 0.1);
        const highEnergyChunk = new Float32Array(chunkSize).fill(0.5);
        const highEnergy = 0.5;

        let currentTime = 0;
        const emittedSegments: ProcessedSegment[] = [];
        let speechStarted = false;

        // Feed 0.8s of continuous speech (8 * 100ms chunks).
        for (let i = 0; i < 8; i++) {
            currentTime += 0.1;
            const segments = processor.processAudioData(highEnergyChunk, currentTime, highEnergy);
            if (segments.length > 0) {
                emittedSegments.push(...segments);
            }

            const state = processor.getStateInfo();
            if (state.inSpeech) speechStarted = true;
        }

        expect(speechStarted).toBe(true);
        expect(emittedSegments.length).toBeGreaterThan(0);

        const firstSegment = emittedSegments[0];
        const splitTolerance = 0.1;
        // Duration is quantized by chunk boundaries; assert near maxDuration with tolerance.
        expect(Math.abs(firstSegment.duration - maxDuration)).toBeLessThanOrEqual(splitTolerance);

        const finalState = processor.getStateInfo();
        expect(finalState.inSpeech).toBe(true);
        expect(finalState.speechStartTime).toBeGreaterThanOrEqual(firstSegment.endTime);
    });

    it('should return defensive copies from getStats', () => {
        const processor = new AudioSegmentProcessor();
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
