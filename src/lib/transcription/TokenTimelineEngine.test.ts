import { describe, it, expect } from 'vitest';
import { TokenTimelineEngine, type TokenChunkInput } from './TokenTimelineEngine';

const idToText: Record<number, string> = {
    1: 'hello',
    2: 'world',
    3: 'today',
    4: 'noise',
    9: 'zzz',
};

const tokenizer = {
    decode(ids: number[]) {
        return ids.map((id) => idToText[id] ?? `${id}`).join(' ').trim();
    },
};

function chunk(
    tokenIds: number[],
    frameIndices: number[],
    opts: Partial<TokenChunkInput> = {}
): TokenChunkInput {
    return {
        tokenIds,
        frameIndices,
        timeOffset: opts.timeOffset ?? 0,
        frameTimeStride: opts.frameTimeStride ?? 0.25,
        logProbs: opts.logProbs ?? tokenIds.map(() => -0.1),
        tokens: tokenIds.map((id) => ({ token: `▁${idToText[id] ?? id}` })),
    };
}

describe('TokenTimelineEngine', () => {
    it('preserves legitimate repeated phrases in stable timeline', () => {
        const engine = new TokenTimelineEngine(tokenizer, {
            stabilityLagSec: 0.2,
            correctionConfirmations: 2,
        });

        const c = chunk([1, 2, 1, 2], [0, 1, 2, 3], { frameTimeStride: 0.3 });
        engine.processCorrection(c, { nowSec: 1.5, cacheHit: true });
        const out = engine.processCorrection(c, { nowSec: 2.0, cacheHit: true });

        expect(out.stableTokens.map((t) => t.id)).toEqual([1, 2, 1, 2]);
        expect(out.stableText).toContain('hello world hello world');
    });

    it('commits tokens only after required correction confirmations', () => {
        const engine = new TokenTimelineEngine(tokenizer, {
            stabilityLagSec: 0.1,
            correctionConfirmations: 2,
        });

        const c = chunk([1, 2, 3], [0, 1, 2], { frameTimeStride: 0.2 });
        const first = engine.processCorrection(c, { nowSec: 1.0 });
        expect(first.commitCursorTime).toBe(0);
        expect(first.stableTokens.length).toBe(0);

        const second = engine.processCorrection(c, { nowSec: 1.2 });
        expect(second.commitCursorTime).toBeGreaterThan(0);
        expect(second.stableTokens.length).toBeGreaterThan(0);
    });

    it('keeps previous draft when a low-score no-anchor correction arrives', () => {
        const engine = new TokenTimelineEngine(tokenizer, {
            stabilityLagSec: 0.8,
            correctionConfirmations: 2,
        });

        // Establish baseline draft
        engine.processFast(chunk([1, 2, 3], [0, 1, 2], { logProbs: [-0.1, -0.1, -0.1] }), {
            nowSec: 1.0,
        });

        // No token-id anchor with much lower average score -> keep existing draft
        const out = engine.processCorrection(
            chunk([9, 9, 9], [0, 1, 2], { logProbs: [-8, -8, -8] }),
            { nowSec: 1.1 },
        );

        expect(out.draftTokens.map((t) => t.id)).toEqual([1, 2, 3]);
        expect(out.stats.rewriteCount).toBe(0);
    });
});
