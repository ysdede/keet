import { describe, it, expect } from 'vitest';
import type { LocalAgreementState, MergedWord } from './LocalAgreementMerger';

// Helper functions copied from transcription.worker.ts for benchmarking
function joinWords(words: Array<{ text: string }>): string {
    if (!words.length) return '';
    let text = '';
    for (let i = 0; i < words.length; i += 1) {
        const current = words[i]?.text || '';
        if (!current) continue;

        let needsSpace = i > 0;
        if (i > 0) {
            const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(current);
            if (noSpaceBefore) {
                needsSpace = false;
            }
            if (current.startsWith("'")) {
                const contractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                if (contractions.includes(current.toLowerCase())) {
                    needsSpace = false;
                }
            }
            const prev = words[i - 1]?.text || '';
            if (current.toLowerCase() === "n't" && prev.toLowerCase().endsWith('n')) {
                needsSpace = false;
            }
        }

        if (needsSpace) text += ' ';
        text += current;
    }
    return text.replace(/\s+/g, ' ').trim();
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
}

function confidenceToLogProb(confidence: number): number {
    return Math.log(Math.max(1e-6, clamp01(confidence)));
}

function average(values: number[], fallback = 0): number {
    if (!values.length) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function wordToTimelineToken(word: MergedWord, index: number, source: 'fast' | 'correction') {
    const confidence = clamp01(Number(word.confidence));
    return {
        id: index,
        text: word.text,
        frameIndex: Math.max(0, Math.round(word.start / 0.08)),
        startTime: word.start,
        endTime: word.end,
        logProb: confidenceToLogProb(confidence),
        stableHits: Math.max(0, Number(word.stabilityCounter) || 0),
        lastCorrectionPass: Math.max(0, Number(word.lastModifiedSequence) || 0),
        source,
    };
}

function buildSentencesFromWords(words: MergedWord[]): Array<{
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
}> {
    if (!words.length) return [];
    const out: Array<{ text: string; startTime: number; endTime: number; confidence: number }> = [];
    let current: MergedWord[] = [];

    const flush = () => {
        if (!current.length) return;
        const startTime = current[0].start;
        const endTime = current[current.length - 1].end;
        out.push({
            text: joinWords(current.map((w) => ({ text: w.text }))),
            startTime,
            endTime,
            confidence: average(current.map((w) => clamp01(Number(w.confidence))), 0.75),
        });
        current = [];
    };

    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        current.push(word);

        const next = i + 1 < words.length ? words[i + 1] : null;
        const punctuationBoundary = /[.?!]$/.test(word.text);
        const pauseBoundary = next ? next.start - word.end >= 0.65 : false;
        const endBoundary = i === words.length - 1;

        if (punctuationBoundary || pauseBoundary || endBoundary) {
            flush();
        }
    }

    return out;
}

function toV5StatePayload(
    state: LocalAgreementState,
    nowSec: number
) {
    const words = Array.isArray(state.words) ? state.words : [];
    const stableWords = words.filter((w) => w.finalized);
    const draftWords = words.filter((w) => !w.finalized);
    const stableTokens = stableWords.map((w, i) => wordToTimelineToken(w, i, 'correction'));
    const draftTokens = draftWords.map((w, i) => wordToTimelineToken(w, i + stableTokens.length, 'fast'));
    const stableText = joinWords(stableWords.map((w) => ({ text: w.text })));
    const draftText = joinWords(draftWords.map((w) => ({ text: w.text })));
    const fullText = state.text || joinWords(words.map((w) => ({ text: w.text })));
    const sentences = buildSentencesFromWords(words);
    const stableLagSec =
        Number.isFinite(nowSec) && nowSec > 0
            ? Math.max(0, nowSec - (Number.isFinite(state.matureCursorTime) ? state.matureCursorTime : 0))
            : 0;
    const sentenceBoundaryConfidence =
        sentences.length === 0 ? 0 : Math.min(1, 0.55 + Math.min(sentences.length, 6) * 0.07);

    return {
        stableTokens,
        draftTokens,
        stableText,
        draftText,
        fullText,
        commitCursorTime: state.matureCursorTime || 0,
        sentences,
        stats: {
            rewriteCount: state.stats?.wordsReplaced || 0,
            stableLagSec,
            commitCursorTime: state.matureCursorTime || 0,
            sentenceBoundaryConfidence,
        },
        matureText: stableText,
        immatureText: draftText,
        matureCursorTime: state.matureCursorTime || 0,
    };
}

function createMockWords(count: number, finalizedPercent = 0.8): MergedWord[] {
    const words: MergedWord[] = [];
    for (let i = 0; i < count; i++) {
        words.push({
            id: `word_${i}`,
            text: `word${i}${i % 10 === 0 ? '.' : ''}`,
            start: i * 0.3,
            end: i * 0.3 + 0.2,
            confidence: 0.9,
            finalized: i < count * finalizedPercent,
            sourceSegmentId: 'seg_1',
            stabilityCounter: 5,
            lastModifiedSequence: 10,
            history: [],
            lockedByUser: false,
        });
    }
    return words;
}

// Optimized version using caching
let v5CachedStableTokens: any[] = [];
let v5CachedStableText = '';
let v5LastMatureCursorTime = -1;

function toV5StatePayloadOptimized(
    state: LocalAgreementState,
    nowSec: number
) {
    const words = Array.isArray(state.words) ? state.words : [];
    
    // Check if we can use cached stable tokens
    if (state.matureCursorTime !== v5LastMatureCursorTime) {
        const stableWords = words.filter((w) => w.finalized);
        v5CachedStableTokens = stableWords.map((w, i) => wordToTimelineToken(w, i, 'correction'));
        v5CachedStableText = joinWords(stableWords.map((w) => ({ text: w.text })));
        v5LastMatureCursorTime = state.matureCursorTime;
    }

    const draftWords = words.filter((w) => !w.finalized);
    const draftTokens = draftWords.map((w, i) => wordToTimelineToken(w, i + v5CachedStableTokens.length, 'fast'));
    const draftText = joinWords(draftWords.map((w) => ({ text: w.text })));
    
    // fullText can be constructed from stableText and draftText if we trust joinWords behavior
    const fullText = v5CachedStableText + (v5CachedStableText && draftText ? ' ' : '') + draftText;
    
    const sentences = buildSentencesFromWords(words);
    const stableLagSec =
        Number.isFinite(nowSec) && nowSec > 0
            ? Math.max(0, nowSec - (Number.isFinite(state.matureCursorTime) ? state.matureCursorTime : 0))
            : 0;
    const sentenceBoundaryConfidence =
        sentences.length === 0 ? 0 : Math.min(1, 0.55 + Math.min(sentences.length, 6) * 0.07);

    return {
        stableTokens: v5CachedStableTokens,
        draftTokens,
        stableText: v5CachedStableText,
        draftText,
        fullText,
        commitCursorTime: state.matureCursorTime || 0,
        sentences,
        stats: {
            rewriteCount: state.stats?.wordsReplaced || 0,
            stableLagSec,
            commitCursorTime: state.matureCursorTime || 0,
            sentenceBoundaryConfidence,
        },
        matureText: v5CachedStableText,
        immatureText: draftText,
        matureCursorTime: state.matureCursorTime || 0,
    };
}

describe('toV5StatePayload Performance', () => {
    it('benchmarks state payload generation overhead', () => {
        const counts = [100, 500, 2000, 5000];
        
        console.log('\n--- toV5StatePayload Benchmark ---');
        counts.forEach(count => {
            const words = createMockWords(count);
            const state: LocalAgreementState = {
                text: '',
                words,
                stats: {
                    totalSegmentsProcessed: 10,
                    totalWordsProcessed: count,
                    segmentsDiscarded: 0,
                    wordsAdded: count,
                    wordsReplaced: 0,
                    wordsKeptStable: count,
                    wordsFinalized: words.filter(w => w.finalized).length,
                },
                matureCursorTime: words.filter(w => w.finalized).pop()?.end || 0,
            };

            // Baseline
            const start1 = performance.now();
            const iterations = 50;
            for (let i = 0; i < iterations; i++) {
                toV5StatePayload(state, count * 0.3);
            }
            const end1 = performance.now();
            const avgTime1 = (end1 - start1) / iterations;

            // Optimized (Cache Hit case)
            v5LastMatureCursorTime = -1; // Reset cache
            toV5StatePayloadOptimized(state, count * 0.3); // Warm up / populate cache
            const start2 = performance.now();
            for (let i = 0; i < iterations; i++) {
                toV5StatePayloadOptimized(state, count * 0.3);
            }
            const end2 = performance.now();
            const avgTime2 = (end2 - start2) / iterations;
            
            console.log(`Words: ${count.toString().padStart(5)} | Baseline: ${avgTime1.toFixed(3)}ms | Optimized: ${avgTime2.toFixed(3)}ms | Gain: ${((avgTime1-avgTime2)/avgTime1*100).toFixed(1)}%`);
        });
        console.log('----------------------------------\n');
    });
});
