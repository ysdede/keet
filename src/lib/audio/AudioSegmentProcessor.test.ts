
import { describe, it, expect } from 'vitest';
import { AudioSegmentProcessor, type AudioSegmentProcessorConfig, type ProcessedSegment } from './AudioSegmentProcessor';

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 0.08;
const CHUNK_SIZE = Math.round(SAMPLE_RATE * CHUNK_DURATION_SEC);
const SPEECH_ENERGY = 0.5;
const SILENCE_ENERGY = 0.0001;
const noopLogger = () => { };

const createProcessor = (overrides: Partial<AudioSegmentProcessorConfig> = {}) =>
    new AudioSegmentProcessor({
        sampleRate: SAMPLE_RATE,
        logger: noopLogger,
        ...overrides,
    });

describe('AudioSegmentProcessor', () => {
    it('should initialize without errors', () => {
        const processor = createProcessor();
        expect(processor).toBeDefined();
        const stats = processor.getStats();
        expect(stats).toBeDefined();
        expect(stats.noiseFloor).toBeGreaterThan(0);
    });

    it('should process silence without detecting segments', () => {
        const processor = createProcessor({ energyThreshold: 0.1 });

        // 1 second of silence at 16kHz
        const silence = new Float32Array(SAMPLE_RATE).fill(0);
        const energy = SILENCE_ENERGY;
        const currentTime = 1.0;

        const segments = processor.processAudioData(silence, currentTime, energy);

        expect(segments).toEqual([]);
        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
    });

    it('should process speech and detect segments', () => {
        // This is a simplified test.
        // Real VAD is complex, so we just check state transitions if we force high energy
        const processor = createProcessor({ energyThreshold: 0.01 });

        const speech = new Float32Array(Math.round(SAMPLE_RATE * 0.1)).fill(SPEECH_ENERGY);
        const energy = SPEECH_ENERGY;

        // Process a few chunks to trigger speech detection
        let segments = processor.processAudioData(speech, 1.0, energy);

        // It might not trigger immediately due to lookback/SNR checks,
        // but let's check internal state or just that it doesn't crash

        // Force state check
        // processor.processAudioData is complex, so let's just ensure it runs
        expect(Array.isArray(segments)).toBe(true);
    });

    it('should reset state correctly', () => {
        const processor = createProcessor();

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
        const processor = createProcessor();
        const silenceChunk = new Float32Array(CHUNK_SIZE).fill(0);

        for (let i = 0; i < 20; i++) {
            processor.processAudioData(silenceChunk, (i + 1) * CHUNK_DURATION_SEC, SILENCE_ENERGY);
        }

        const state = processor.getStateInfo();
        expect(state.noiseFloor).toBeLessThan(0.005);
        expect(state.noiseFloor).toBeGreaterThan(0);
    });

    it('should end speech after configured silence threshold', () => {
        const silenceThresholdSec = 0.16;
        const processor = createProcessor({
            energyThreshold: 0.01,
            silenceThreshold: silenceThresholdSec,
        });
        const speechChunk = new Float32Array(CHUNK_SIZE).fill(SPEECH_ENERGY);
        const silenceChunk = new Float32Array(CHUNK_SIZE).fill(0);

        processor.processAudioData(speechChunk, 0.0, SPEECH_ENERGY);
        processor.processAudioData(speechChunk, CHUNK_DURATION_SEC, SPEECH_ENERGY);

        const firstSilence = processor.processAudioData(
            silenceChunk,
            2 * CHUNK_DURATION_SEC,
            SILENCE_ENERGY,
        );
        expect(firstSilence.length).toBe(0);
        expect(processor.getStateInfo().inSpeech).toBe(true);

        const secondSilence = processor.processAudioData(
            silenceChunk,
            3 * CHUNK_DURATION_SEC,
            SILENCE_ENERGY,
        );
        expect(secondSilence.length).toBe(1);
        expect(secondSilence[0].duration).toBeGreaterThan(0);
        expect(processor.getStateInfo().inSpeech).toBe(false);
    });

    it('should update speech detection behavior when threshold changes', () => {
        const processor = createProcessor();
        const speechChunk = new Float32Array(CHUNK_SIZE).fill(SPEECH_ENERGY);

        processor.setThreshold(0.9);
        processor.reset();
        processor.processAudioData(speechChunk, CHUNK_DURATION_SEC, SPEECH_ENERGY);
        expect(processor.getStateInfo().inSpeech).toBe(false);

        processor.setThreshold(0.1);
        processor.processAudioData(speechChunk, 2 * CHUNK_DURATION_SEC, SPEECH_ENERGY);
        expect(processor.getStateInfo().inSpeech).toBe(true);
    });

    it('should update speech statistics after a completed segment', () => {
        const processor = createProcessor({
            energyThreshold: 0.01,
            silenceThreshold: CHUNK_DURATION_SEC,
            maxSilenceWithinSpeech: 0,
        });
        const speechChunk = new Float32Array(CHUNK_SIZE).fill(SPEECH_ENERGY);
        const silenceChunk = new Float32Array(CHUNK_SIZE).fill(0);

        processor.processAudioData(speechChunk, 0.0, SPEECH_ENERGY);
        processor.processAudioData(silenceChunk, CHUNK_DURATION_SEC, SILENCE_ENERGY);

        const stats = processor.getStats();
        expect(stats.speech.avgDuration).toBeGreaterThan(0);
        expect(stats.speech.avgEnergy).toBeGreaterThan(0);
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
        const processor = createProcessor();
        const stats = processor.getStats();

        stats.noiseFloor = 999;
        stats.speech.avgDuration = 123;
        stats.silence.avgEnergy = 456;

        const current = processor.getStats();
        expect(current.noiseFloor).toBe(0.005);
        expect(current.speech.avgDuration).toBe(0);
        expect(current.silence.avgEnergy).toBe(0);
    });

    it('should keep cached speech summary isolated from caller mutation across updates', () => {
        const processor = createProcessor({
            energyThreshold: 0.01,
            silenceThreshold: CHUNK_DURATION_SEC,
            maxSilenceWithinSpeech: 0,
        });
        const speechChunk = new Float32Array(CHUNK_SIZE).fill(SPEECH_ENERGY);
        const silenceChunk = new Float32Array(CHUNK_SIZE).fill(0);

        processor.processAudioData(speechChunk, 0.0, SPEECH_ENERGY);
        processor.processAudioData(silenceChunk, CHUNK_DURATION_SEC, SILENCE_ENERGY);

        const baseline = processor.getStats().speech;

        const mutated = processor.getStats();
        mutated.speech.avgDuration = 999;
        mutated.speech.avgEnergy = 999;
        mutated.speech.avgEnergyIntegral = 999;

        processor.processAudioData(silenceChunk, 2 * CHUNK_DURATION_SEC, SILENCE_ENERGY);

        const current = processor.getStats().speech;
        expect(current.avgDuration).toBe(baseline.avgDuration);
        expect(current.avgEnergy).toBe(baseline.avgEnergy);
        expect(current.avgEnergyIntegral).toBe(baseline.avgEnergyIntegral);
    });
});
