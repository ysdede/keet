import { describe, expect, test } from 'vitest';
import { UtteranceBasedMerger, type ASRWord } from './UtteranceBasedMerger';

type WordTuple = [text: string, start: number, end?: number];

function wordsFromTuples(tuples: WordTuple[]): ASRWord[] {
    return tuples.map(([text, start, end]) => ({
        text,
        start_time: start,
        end_time: end ?? start + 0.4,
        confidence: 0.9,
    }));
}

function asrFromTuples(tuples: WordTuple[]) {
    const words = wordsFromTuples(tuples);
    return {
        utterance_text: words.map((w) => w.text).join(' '),
        words,
        end_time: words.length > 0 ? words[words.length - 1].end_time : 0,
    };
}

function createMerger() {
    return new UtteranceBasedMerger({
        useNLP: false,
        debug: false,
    });
}

describe('UtteranceBasedMerger streaming regression fixtures', () => {
    test('partial-to-full merging and overlap conflict resolution remain coherent', () => {
        const merger = createMerger();

        const fixtures = [
            {
                words: [
                    ['hello', 0.0, 0.4],
                    ['there', 0.4, 0.8],
                ] as WordTuple[],
                expected: { mature: '', immature: 'hello there', full: 'hello there', cursor: 0.0 },
            },
            {
                words: [
                    ['hello', 0.0, 0.4],
                    ['there.', 0.4, 0.8],
                    ['how', 0.8, 1.1],
                ] as WordTuple[],
                expected: { mature: 'hello there.', immature: 'how', full: 'hello there. how', cursor: 0.8 },
            },
            {
                words: [
                    ['hello', 0.0, 0.4],
                    ['there.', 0.4, 0.8],
                    ['how', 0.8, 1.1],
                    ['are', 1.1, 1.4],
                    ['you', 1.4, 1.8],
                ] as WordTuple[],
                expected: { mature: 'hello there.', immature: 'how are you', full: 'hello there. how are you', cursor: 0.8 },
            },
            {
                words: [
                    ['hello', 0.0, 0.4],
                    ['there.', 0.4, 0.8],
                    ['how', 0.8, 1.1],
                    ['are', 1.1, 1.4],
                    ['you?', 1.4, 1.8],
                    ['next', 1.8, 2.2],
                ] as WordTuple[],
                expected: {
                    mature: 'hello there. how are you?',
                    immature: 'next',
                    full: 'hello there. how are you? next',
                    cursor: 1.8,
                },
            },
        ];

        for (const fixture of fixtures) {
            const result = merger.processASRResult(asrFromTuples(fixture.words));
            expect(result.matureText).toBe(fixture.expected.mature);
            expect(result.immatureText).toBe(fixture.expected.immature);
            expect(result.fullText).toBe(fixture.expected.full);
            expect(result.matureCursorTime).toBe(fixture.expected.cursor);
        }
    });

    test('punctuation/case restoration from overlapping windows keeps latest coherent sentence text', () => {
        const merger = createMerger();

        merger.processASRResult(
            asrFromTuples([
                ['good', 0.0, 0.3],
                ['morning', 0.3, 0.7],
                ['everyone', 0.7, 1.1],
            ]),
        );

        const refined = merger.processASRResult(
            asrFromTuples([
                ['Good', 0.0, 0.3],
                ['morning', 0.3, 0.7],
                ['everyone.', 0.7, 1.1],
                ['today', 1.1, 1.4],
            ]),
        );

        expect(refined.matureText).toBe('Good morning everyone.');
        expect(refined.immatureText).toBe('today');
        expect(refined.fullText).toBe('Good morning everyone. today');
    });

    test('repeated words, delayed tokens, and retranscription overlap stay deduped', () => {
        const merger = createMerger();

        const first = merger.processASRResult(
            asrFromTuples([
                ['I', 0.0, 0.3],
                ['I', 0.3, 0.6],
                ['think', 0.6, 1.0],
            ]),
        );
        expect(first.immatureText).toBe('I I think');

        const corrected = merger.processASRResult(
            asrFromTuples([
                ['I', 0.0, 0.3],
                ['think', 0.3, 0.8],
                ['this', 0.8, 1.2],
            ]),
        );
        expect(corrected.immatureText).toBe('I think this');

        const completed = merger.processASRResult(
            asrFromTuples([
                ['I', 0.0, 0.3],
                ['think', 0.3, 0.8],
                ['this', 0.8, 1.2],
                ['works.', 1.2, 1.6],
                ['now', 1.6, 2.0],
            ]),
        );
        expect(completed.matureText).toBe('I think this works.');
        expect(completed.immatureText).toBe('now');

        const staleOverlap = merger.processASRResult(
            asrFromTuples([
                ['I', 0.0, 0.3],
                ['think', 0.3, 0.82],
                ['this', 0.82, 1.18],
                ['works.', 1.18, 1.62],
                ['now', 1.62, 2.02],
                ['again', 2.02, 2.4],
            ]),
        );
        expect(staleOverlap.matureText).toBe('I think this works.');
        expect(staleOverlap.immatureText).toBe('now again');
        expect(staleOverlap.allMatureSentences).toHaveLength(1);
    });

    test('short pause does not flush incomplete sentence, long pause flushes complete one', () => {
        const merger = createMerger();

        merger.processASRResult(
            asrFromTuples([
                ['we', 0.0, 0.3],
                ['are', 0.3, 0.6],
                ['testing', 0.6, 1.0],
            ]),
        );
        expect(merger.finalizePendingSentenceByTimeout()).toBeNull();

        merger.processASRResult(
            asrFromTuples([
                ['we', 0.0, 0.3],
                ['are', 0.3, 0.6],
                ['testing.', 0.6, 1.0],
            ]),
        );
        const flushed = merger.finalizePendingSentenceByTimeout();
        expect(flushed).not.toBeNull();
        expect(flushed?.matureText).toBe('we are testing.');
        expect(flushed?.immatureText).toBe('');
    });
});

