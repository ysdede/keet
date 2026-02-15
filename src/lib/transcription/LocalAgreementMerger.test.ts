import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAgreementMerger, type AgreementMergeInput } from './LocalAgreementMerger';

function buildInput(
    segmentId: string,
    sequence: number,
    words: Array<{ word: string; start: number; end: number; confidence?: number }>,
    segmentConfidence = 0.9,
    endTime?: number
): AgreementMergeInput {
    return {
        segmentId,
        sequence,
        segments: [{
            confidence: segmentConfidence,
            words,
        }],
        endTime: endTime ?? words[words.length - 1]?.end ?? 0,
    };
}

describe('LocalAgreementMerger', () => {
    let merger: LocalAgreementMerger;

    beforeEach(() => {
        merger = new LocalAgreementMerger({
            debug: false,
            segmentFilterMinAbsoluteConfidence: 0.05,
            finalizationAgeThreshold: 0.8,
        });
    });

    it('starts with empty canonical state', () => {
        const state = merger.getCurrentState();
        expect(state.text).toBe('');
        expect(state.words).toEqual([]);
        expect(state.matureCursorTime).toBe(0);
        expect(state.stats.totalSegmentsProcessed).toBe(0);
    });

    it('keeps existing words and increments stability on full local agreement', () => {
        merger.merge(buildInput('s1', 1, [
            { word: 'hello', start: 0.1, end: 0.4, confidence: 0.92 },
            { word: 'world', start: 0.45, end: 0.8, confidence: 0.9 },
        ]));

        const second = merger.merge(buildInput('s2', 2, [
            { word: 'hello', start: 0.1, end: 0.4, confidence: 0.95 },
            { word: 'world', start: 0.45, end: 0.8, confidence: 0.95 },
        ], 0.95));

        expect(second.words).toHaveLength(2);
        expect(second.words.map((w) => w.text)).toEqual(['hello', 'world']);
        expect(second.words.every((w) => w.stabilityCounter > 0)).toBe(true);
        expect(second.stats.wordsAdded).toBe(2);
        expect(second.stats.wordsReplaced).toBe(0);
        expect(second.stats.wordsKeptStable).toBe(2);
    });

    it('partially replaces disagreement tail after agreement prefix', () => {
        merger.merge(buildInput('s1', 1, [
            { word: 'partial', start: 0.1, end: 0.5, confidence: 0.9 },
            { word: 'agreement', start: 0.55, end: 1.0, confidence: 0.9 },
            { word: 'old', start: 1.05, end: 1.3, confidence: 0.7 },
        ], 0.85));

        const next = merger.merge(buildInput('s2', 2, [
            { word: 'partial', start: 0.1, end: 0.5, confidence: 0.95 },
            { word: 'agreement', start: 0.55, end: 1.0, confidence: 0.94 },
            { word: 'new', start: 1.05, end: 1.32, confidence: 0.92 },
        ], 0.93));

        expect(next.words.map((w) => w.text)).toEqual(['partial', 'agreement', 'new']);
        expect(next.stats.wordsReplaced).toBe(1);
        expect(next.stats.wordsKeptStable).toBe(2);
    });

    it('collapses redundant boundary duplicate and updates stronger overlap word', () => {
        merger.merge(buildInput('s1', 1, [
            { word: 'hello', start: 0.10, end: 0.35, confidence: 0.90 },
            { word: 'world', start: 0.36, end: 0.62, confidence: 0.70 },
        ], 0.8));

        const next = merger.merge(buildInput('s2', 2, [
            { word: 'hello', start: 0.10, end: 0.35, confidence: 0.92 },
            { word: 'world', start: 0.36, end: 0.62, confidence: 0.80 },
            { word: 'world', start: 0.52, end: 0.90, confidence: 0.95 },
        ], 0.92));

        expect(next.words).toHaveLength(2);
        expect(next.words.map((w) => w.text)).toEqual(['hello', 'world']);
        expect(next.words[1].end).toBeCloseTo(0.90, 2);
        expect(next.words[1].confidence).toBeGreaterThan(0.90);
    });

    it('vetoes replacement when stable higher-confidence existing word conflicts', () => {
        merger.merge(buildInput('s1', 1, [
            { word: 'keepme', start: 0.10, end: 0.40, confidence: 0.95 },
            { word: 'weak', start: 0.41, end: 0.70, confidence: 0.20 },
        ], 0.7));

        const internalWords = (merger as any).mergedTranscript as Array<any>;
        internalWords[0].stabilityCounter = 3;
        internalWords[0].lastModifiedSequence = 1;

        const next = merger.merge(buildInput('s2', 3, [
            { word: 'wrong', start: 0.10, end: 0.40, confidence: 0.60 },
            { word: 'new', start: 0.41, end: 0.70, confidence: 0.95 },
        ], 0.9));

        expect(next.words).toHaveLength(2);
        expect(next.words[0].text).toBe('keepme');
    });

    it('finalizes matured words on flush after stability threshold', () => {
        const stableMerger = new LocalAgreementMerger({
            debug: false,
            segmentFilterMinAbsoluteConfidence: 0.05,
            finalizationStabilityThreshold: 1,
            useAgeFinalization: false,
            minInitialContextTime: 0,
        });

        stableMerger.merge(buildInput('s1', 1, [
            { word: 'one', start: 0.1, end: 0.3, confidence: 0.9 },
            { word: 'two', start: 0.32, end: 0.55, confidence: 0.9 },
        ]));
        stableMerger.merge(buildInput('s2', 2, [
            { word: 'one', start: 0.1, end: 0.3, confidence: 0.91 },
            { word: 'two', start: 0.32, end: 0.55, confidence: 0.91 },
        ], 0.91));

        const flushed = stableMerger.flush(1.2, 3);
        expect(flushed.words.length).toBe(2);
        expect(flushed.words.every((w) => w.finalized)).toBe(true);
        expect(flushed.matureCursorTime).toBeGreaterThan(0);
        expect(flushed.stats.wordsFinalized).toBe(2);
    });
});
