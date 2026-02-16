import { describe, expect, test } from 'vitest';
import { UtteranceBasedMerger, type ASRWord } from './UtteranceBasedMerger';

function mkWord(text: string, start: number, end?: number): ASRWord {
    return {
        text,
        start_time: start,
        end_time: end ?? start + 0.5,
        confidence: 0.9,
    };
}

function asr(words: ASRWord[]) {
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

describe('UtteranceBasedMerger fast-merger parity', () => {
    test('single sentence is kept immature', () => {
        const merger = createMerger();
        const result = merger.processASRResult(asr([mkWord('Hello', 0), mkWord('world.', 0.5)]));

        expect(result.matureText).toBe('');
        expect(result.immatureText).toBe('Hello world.');
        expect(result.matureCursorTime).toBe(0);
        expect(result.allMatureSentences).toHaveLength(0);
    });

    test('multiple sentences finalize all but last', () => {
        const merger = createMerger();
        const result = merger.processASRResult(
            asr([
                mkWord('Hello', 0.0),
                mkWord('world.', 0.5),
                mkWord('How', 1.0),
                mkWord('are', 1.5),
                mkWord('you?', 2.0),
            ]),
        );

        expect(result.matureText).toBe('Hello world.');
        expect(result.immatureText).toBe('How are you?');
        expect(result.matureCursorTime).toBe(1.0);
        expect(result.allMatureSentences).toHaveLength(1);
    });

    test('cursor advances across cycles', () => {
        const merger = createMerger();

        merger.processASRResult(
            asr([mkWord('Sentence', 0.0), mkWord('one.', 0.5), mkWord('Start', 1.0)]),
        );

        const cycle2 = merger.processASRResult(
            asr([mkWord('Start', 1.0), mkWord('two.', 1.5), mkWord('End', 2.0)]),
        );

        expect(cycle2.matureText).toBe('Sentence one. Start two.');
        expect(cycle2.immatureText).toBe('End');
        expect(cycle2.matureCursorTime).toBe(2.0);
    });

    test('duplicate finalized sentence is not re-added', () => {
        const merger = createMerger();

        merger.processASRResult(
            asr([mkWord('Hello', 0.0), mkWord('world.', 0.5), mkWord('How', 1.0)]),
        );
        const stale = merger.processASRResult(
            asr([
                mkWord('Hello', 0.0),
                mkWord('world.', 0.5),
                mkWord('How', 1.0),
                mkWord('are', 1.5),
            ]),
        );

        expect(stale.allMatureSentences).toHaveLength(1);
        expect(stale.matureText).toBe('Hello world.');
        expect(stale.immatureText).toBe('How are');
    });

    test('duplicate detection tolerates small timing jitter', () => {
        const merger = createMerger();

        merger.processASRResult(
            asr([
                mkWord('Hello', 0.0, 0.5),
                mkWord('world.', 0.5, 1.0),
                mkWord('More', 1.0, 1.5),
            ]),
        );
        const jittered = merger.processASRResult(
            asr([
                mkWord('Hello', 0.0, 0.48),
                mkWord('world.', 0.48, 1.05),
                mkWord('More', 1.05, 1.55),
                mkWord('text.', 1.55, 2.05),
            ]),
        );

        expect(jittered.allMatureSentences).toHaveLength(1);
        expect(jittered.matureText).toBe('Hello world.');
        expect(jittered.immatureText).toBe('More text.');
    });

    test('reprocessing identical window does not duplicate mature sentences', () => {
        const merger = createMerger();
        const base = [mkWord('cooperating.', 4.5, 5.0), mkWord('Third', 5.0, 5.5), mkWord('round.', 5.5, 6.0)];

        merger.processASRResult(asr(base));
        merger.processASRResult(asr(base));
        const third = merger.processASRResult(asr(base));

        expect(third.allMatureSentences).toHaveLength(1);
        expect(third.fullText).toBe('cooperating. Third round.');
    });

    test('timeout flush finalizes pending sentence and stale reprocess stays deduped', () => {
        const merger = createMerger();

        merger.processASRResult(asr([mkWord('Hello', 0.0), mkWord('world.', 0.5)]));
        const flushed = merger.finalizePendingSentenceByTimeout();
        expect(flushed).not.toBeNull();
        expect(flushed?.matureText).toBe('Hello world.');

        const stale = merger.processASRResult(
            asr([
                mkWord('Hello', 0.0),
                mkWord('world.', 0.5),
                mkWord('How', 1.0),
                mkWord('are', 1.5),
            ]),
        );

        expect(stale.allMatureSentences).toHaveLength(1);
        expect(stale.immatureText).toBe('How are');
    });

    test('forceFinalizeAll follows dedup semantics', () => {
        const merger = createMerger();

        merger.processASRResult(asr([mkWord('Test', 0.0), mkWord('sentence.', 0.5)]));
        merger.forceFinalizeAll();

        const next = merger.processASRResult(
            asr([
                mkWord('Test', 0.0),
                mkWord('sentence.', 0.5),
                mkWord('New', 1.0),
                mkWord('words.', 1.5),
            ]),
        );

        expect(next.allMatureSentences).toHaveLength(1);
        expect(next.immatureText).toBe('New words.');
    });

    test('flush returns null when nothing pending', () => {
        const merger = createMerger();

        merger.processASRResult(asr([mkWord('Done.', 0.0, 0.5)]));
        const firstFlush = merger.finalizePendingSentenceByTimeout();
        const secondFlush = merger.finalizePendingSentenceByTimeout();

        expect(firstFlush).not.toBeNull();
        expect(secondFlush).toBeNull();
    });

    test('expanding windows replace immature buffer instead of accumulating', () => {
        const merger = createMerger();

        merger.processASRResult(asr([mkWord('Hello', 0.0)]));
        expect(merger.getImmatureText()).toBe('Hello');

        merger.processASRResult(asr([mkWord('Hello', 0.0), mkWord('world', 0.5)]));
        expect(merger.getImmatureText()).toBe('Hello world');

        const third = merger.processASRResult(
            asr([mkWord('Hello', 0.0), mkWord('world.', 0.5), mkWord('How', 1.0)]),
        );
        expect(third.matureText).toBe('Hello world.');
        expect(third.immatureText).toBe('How');
        expect(third.matureCursorTime).toBe(1.0);
    });

    test('reset clears all state', () => {
        const merger = createMerger();
        merger.processASRResult(
            asr([mkWord('Hello', 0.0), mkWord('world.', 0.5), mkWord('More', 1.0)]),
        );

        merger.reset();

        expect(merger.getMatureText()).toBe('');
        expect(merger.getImmatureText()).toBe('');
        expect(merger.getMatureCursorTime()).toBe(0);
        expect(merger.getPendingSentence()).toBeNull();
    });

    test('empty input keeps current state', () => {
        const merger = createMerger();
        merger.processASRResult(
            asr([mkWord('Hello', 0.0), mkWord('world.', 0.5), mkWord('How', 1.0)]),
        );

        const before = merger.getFullText();
        const after = merger.processASRResult({
            utterance_text: '',
            words: [],
            end_time: 0,
        });

        expect(after.fullText).toBe(before);
        expect(after.matureCursorTime).toBe(1.0);
    });
});
