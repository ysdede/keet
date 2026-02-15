/**
 * TokenTimelineEngine
 *
 * V5 canonical streaming state: token timeline with stable + draft regions.
 * Sentence text and legacy mature/immature fields are always derived from this
 * token state (never the other way around).
 */

import { SentenceBoundaryDetector, type DetectorWord } from './SentenceBoundaryDetector';

export type TimelinePassKind = 'fast' | 'correction';

export interface TimelineTokenizer {
    decode(ids: number[]): string;
}

export interface TokenChunkInput {
    tokenIds: number[];
    frameIndices: number[];
    timeOffset: number;
    frameTimeStride: number;
    tokens?: Array<{ token?: string; text?: string }>;
    logProbs?: number[];
}

export interface TimelineToken {
    id: number;
    text: string;
    frameIndex: number;
    startTime: number;
    endTime: number;
    logProb: number;
    stableHits: number;
    lastCorrectionPass: number;
    source: TimelinePassKind;
}

export interface TimelineSentence {
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
}

export interface TimelineStats {
    rewriteCount: number;
    stableLagSec: number;
    correctionPasses: number;
    correctionHitRatio: number;
    cacheHitRatio: number;
    commitCursorTime: number;
    sentenceBoundaryConfidence: number;
}

export interface StreamStateResult {
    stableTokens: TimelineToken[];
    draftTokens: TimelineToken[];
    stableText: string;
    draftText: string;
    fullText: string;
    commitCursorTime: number;
    sentences: TimelineSentence[];
    stats: TimelineStats;
    // Legacy adapter fields for v4-compatible UI consumers
    matureText: string;
    immatureText: string;
    matureCursorTime: number;
}

export interface TokenTimelineEngineConfig {
    stabilityLagSec: number;
    correctionConfirmations: number;
    timeToleranceSec: number;
    debug: boolean;
}

interface ProcessOptions {
    nowSec?: number;
    cacheHit?: boolean;
}

interface LcsResult {
    startA: number;
    startB: number;
    length: number;
}

interface ReconcileResult {
    merged: TimelineToken[];
    anchorHit: boolean;
    rewrites: number;
}

export class TokenTimelineEngine {
    private readonly tokenizer: TimelineTokenizer;
    private readonly sentenceDetector: SentenceBoundaryDetector;
    private readonly config: TokenTimelineEngineConfig;

    private stableTokens: TimelineToken[] = [];
    private draftTokens: TimelineToken[] = [];
    private commitCursorTime = 0;
    private correctionPass = 0;
    private rewriteCount = 0;
    private correctionPasses = 0;
    private correctionAnchorHits = 0;
    private cacheSamples = 0;
    private cacheHits = 0;
    private lastNowSec = 0;

    constructor(tokenizer: TimelineTokenizer, config: Partial<TokenTimelineEngineConfig> = {}) {
        this.tokenizer = tokenizer;
        this.config = {
            stabilityLagSec: 0.8,
            correctionConfirmations: 2,
            timeToleranceSec: 0.18,
            debug: false,
            ...config,
        };
        this.sentenceDetector = new SentenceBoundaryDetector({
            useNLP: true,
            debug: false,
            nlpContextSentences: 5,
        });
    }

    reset(): void {
        this.stableTokens = [];
        this.draftTokens = [];
        this.commitCursorTime = 0;
        this.correctionPass = 0;
        this.rewriteCount = 0;
        this.correctionPasses = 0;
        this.correctionAnchorHits = 0;
        this.cacheSamples = 0;
        this.cacheHits = 0;
        this.lastNowSec = 0;
        this.sentenceDetector.reset();
    }

    processFast(chunk: TokenChunkInput, options: ProcessOptions = {}): StreamStateResult {
        this.recordCacheSample(options.cacheHit);
        const incoming = this.normalizeChunk(chunk, 'fast');
        const nowSec = this.resolveNowSec(incoming, options.nowSec);
        this.lastNowSec = nowSec;

        if (incoming.length > 0) {
            const cut = incoming[0].startTime - this.config.timeToleranceSec;
            const prefix = this.draftTokens.filter((t) => t.endTime <= cut);
            const merged = this.dedupeTokens([...prefix, ...incoming]);
            this.draftTokens = merged;
        }

        return this.buildState(nowSec);
    }

    processCorrection(chunk: TokenChunkInput, options: ProcessOptions = {}): StreamStateResult {
        this.recordCacheSample(options.cacheHit);
        const incoming = this.normalizeChunk(chunk, 'correction');
        const nowSec = this.resolveNowSec(incoming, options.nowSec);
        this.lastNowSec = nowSec;

        this.correctionPass += 1;
        this.correctionPasses += 1;

        if (incoming.length > 0) {
            const reconcile = this.reconcileCorrection(this.draftTokens, incoming);
            this.draftTokens = this.stampCorrectionStability(reconcile.merged);
            this.rewriteCount += reconcile.rewrites;
            if (reconcile.anchorHit) {
                this.correctionAnchorHits += 1;
            }
        }

        this.commitStable(nowSec);
        return this.buildState(nowSec);
    }

    finalizeSilence(options: ProcessOptions = {}): StreamStateResult {
        const nowSec = options.nowSec ?? this.lastNowSec;
        this.commitStable(nowSec);
        return this.buildState(nowSec);
    }

    private resolveNowSec(incoming: TimelineToken[], nowSec?: number): number {
        if (typeof nowSec === 'number' && Number.isFinite(nowSec)) {
            return nowSec;
        }
        if (incoming.length > 0) {
            return incoming[incoming.length - 1].endTime;
        }
        return this.lastNowSec;
    }

    private recordCacheSample(cacheHit?: boolean): void {
        if (typeof cacheHit === 'boolean') {
            this.cacheSamples += 1;
            if (cacheHit) this.cacheHits += 1;
        }
    }

    private normalizeChunk(chunk: TokenChunkInput, source: TimelinePassKind): TimelineToken[] {
        const ids = chunk.tokenIds || [];
        const frames = chunk.frameIndices || [];
        const logs = chunk.logProbs || [];
        if (!ids.length || !frames.length || ids.length !== frames.length) {
            return [];
        }

        const stride = chunk.frameTimeStride > 0 ? chunk.frameTimeStride : 0.08;
        const out: TimelineToken[] = [];

        for (let i = 0; i < ids.length; i++) {
            const start = chunk.timeOffset + frames[i] * stride;
            const nextFrame = i + 1 < frames.length ? frames[i + 1] : frames[i] + 1;
            const end = chunk.timeOffset + Math.max(nextFrame, frames[i] + 1) * stride;
            const txt = chunk.tokens?.[i]?.token ?? chunk.tokens?.[i]?.text ?? '';
            out.push({
                id: ids[i],
                text: txt,
                frameIndex: frames[i],
                startTime: start,
                endTime: Math.max(start + stride * 0.5, end),
                logProb: logs[i] ?? 0,
                stableHits: source === 'correction' ? 1 : 0,
                lastCorrectionPass: source === 'correction' ? this.correctionPass : 0,
                source,
            });
        }

        return this.dedupeTokens(out);
    }

    private dedupeTokens(tokens: TimelineToken[]): TimelineToken[] {
        if (tokens.length < 2) return tokens.slice();
        const sorted = [...tokens].sort((a, b) => a.startTime - b.startTime || a.id - b.id);
        const out: TimelineToken[] = [];
        for (const tok of sorted) {
            const prev = out[out.length - 1];
            if (!prev) {
                out.push(tok);
                continue;
            }

            const sameIdentity = prev.id === tok.id && Math.abs(prev.startTime - tok.startTime) <= this.config.timeToleranceSec;
            if (sameIdentity) {
                if ((tok.logProb ?? -Infinity) > (prev.logProb ?? -Infinity)) {
                    out[out.length - 1] = tok;
                }
                continue;
            }

            out.push(tok);
        }
        return out;
    }

    private reconcileCorrection(existingDraft: TimelineToken[], incoming: TimelineToken[]): ReconcileResult {
        if (!existingDraft.length) {
            return { merged: incoming, anchorHit: false, rewrites: 0 };
        }

        const overlapCut = incoming[0].startTime - this.config.timeToleranceSec;
        const overlapStart = existingDraft.findIndex((t) => t.endTime >= overlapCut);
        if (overlapStart < 0) {
            return { merged: this.dedupeTokens([...existingDraft, ...incoming]), anchorHit: false, rewrites: 0 };
        }

        const prefix = existingDraft.slice(0, overlapStart);
        const tail = existingDraft.slice(overlapStart);
        const lcs = this.longestCommonSubstring(tail, incoming);

        if (lcs.length > 0) {
            const aAnchor = tail.slice(lcs.startA, lcs.startA + lcs.length);
            const bAnchor = incoming.slice(lcs.startB, lcs.startB + lcs.length);
            const timeAligned = this.isTimeAligned(aAnchor, bAnchor);
            const anchor = this.pickHigherScore(aAnchor, bAnchor);
            const mergedTail = [
                ...tail.slice(0, lcs.startA),
                ...anchor,
                ...incoming.slice(lcs.startB + lcs.length),
            ];
            const merged = this.dedupeTokens([...prefix, ...mergedTail]);
            const rewrites = Math.max(0, tail.length - mergedTail.length + incoming.length - lcs.length);
            return { merged, anchorHit: timeAligned, rewrites };
        }

        const winner = this.pickHigherScore(tail, incoming);
        const merged = this.dedupeTokens([...prefix, ...winner]);
        const rewrites = winner === incoming ? tail.length : 0;
        return { merged, anchorHit: false, rewrites };
    }

    private longestCommonSubstring(a: TimelineToken[], b: TimelineToken[]): LcsResult {
        const n = a.length;
        const m = b.length;
        if (!n || !m) return { startA: 0, startB: 0, length: 0 };

        const dp = new Array<number>(m + 1).fill(0);
        let bestLen = 0;
        let bestEndA = 0;
        let bestEndB = 0;

        for (let i = 1; i <= n; i++) {
            let prev = 0;
            for (let j = 1; j <= m; j++) {
                const tmp = dp[j];
                if (a[i - 1].id === b[j - 1].id) {
                    dp[j] = prev + 1;
                    if (dp[j] > bestLen) {
                        bestLen = dp[j];
                        bestEndA = i;
                        bestEndB = j;
                    }
                } else {
                    dp[j] = 0;
                }
                prev = tmp;
            }
        }

        return {
            startA: bestEndA - bestLen,
            startB: bestEndB - bestLen,
            length: bestLen,
        };
    }

    private isTimeAligned(a: TimelineToken[], b: TimelineToken[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (Math.abs(a[i].startTime - b[i].startTime) > this.config.timeToleranceSec) {
                return false;
            }
        }
        return true;
    }

    private pickHigherScore(a: TimelineToken[], b: TimelineToken[]): TimelineToken[] {
        const score = (arr: TimelineToken[]) => {
            if (!arr.length) return -Infinity;
            return arr.reduce((sum, t) => sum + (t.logProb ?? 0), 0) / arr.length;
        };
        return score(b) >= score(a) ? b : a;
    }

    private stampCorrectionStability(merged: TimelineToken[]): TimelineToken[] {
        const previous = this.draftTokens;
        const out: TimelineToken[] = [];

        for (const tok of merged) {
            const prev = previous.find(
                (p) =>
                    p.id === tok.id &&
                    Math.abs(p.startTime - tok.startTime) <= this.config.timeToleranceSec
            );

            out.push({
                ...tok,
                stableHits: prev ? Math.max(1, prev.stableHits + 1) : 1,
                lastCorrectionPass: this.correctionPass,
                source: 'correction',
            });
        }

        return out;
    }

    private commitStable(nowSec: number): void {
        while (this.draftTokens.length > 0) {
            const head = this.draftTokens[0];
            const isOldEnough = head.endTime <= (nowSec - this.config.stabilityLagSec);
            const hasConfirmations = head.stableHits >= this.config.correctionConfirmations;
            if (!isOldEnough || !hasConfirmations) break;
            this.stableTokens.push(head);
            this.draftTokens.shift();
            this.commitCursorTime = head.endTime;
        }
    }

    private buildState(nowSec: number): StreamStateResult {
        const stableText = this.decodeTokens(this.stableTokens);
        const draftText = this.decodeTokens(this.draftTokens);
        const fullText = this.decodeTokens([...this.stableTokens, ...this.draftTokens]);
        const sentences = this.deriveSentences([...this.stableTokens, ...this.draftTokens]);
        const sentenceBoundaryConfidence =
            sentences.length > 0
                ? sentences.reduce((sum, s) => sum + s.confidence, 0) / sentences.length
                : 0;

        const stats: TimelineStats = {
            rewriteCount: this.rewriteCount,
            stableLagSec: Math.max(0, nowSec - this.commitCursorTime),
            correctionPasses: this.correctionPasses,
            correctionHitRatio:
                this.correctionPasses > 0 ? this.correctionAnchorHits / this.correctionPasses : 0,
            cacheHitRatio: this.cacheSamples > 0 ? this.cacheHits / this.cacheSamples : 0,
            commitCursorTime: this.commitCursorTime,
            sentenceBoundaryConfidence,
        };

        return {
            stableTokens: this.stableTokens.slice(),
            draftTokens: this.draftTokens.slice(),
            stableText,
            draftText,
            fullText,
            commitCursorTime: this.commitCursorTime,
            sentences,
            stats,
            matureText: stableText,
            immatureText: draftText,
            matureCursorTime: this.commitCursorTime,
        };
    }

    private decodeTokens(tokens: TimelineToken[]): string {
        const ids = tokens.map((t) => t.id);
        if (!ids.length) return '';
        try {
            return this.tokenizer.decode(ids).trim();
        } catch {
            return this.fallbackTokenText(tokens);
        }
    }

    private fallbackTokenText(tokens: TimelineToken[]): string {
        const pieces: string[] = [];
        for (const tok of tokens) {
            if (!tok.text) continue;
            pieces.push(tok.text);
        }
        return pieces.join('').replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private deriveSentences(tokens: TimelineToken[]): TimelineSentence[] {
        const words = this.tokensToWords(tokens);
        if (!words.length) return [];

        const endings = this.sentenceDetector.detectSentenceEndings(words);
        if (!endings.length) return [];

        const results: TimelineSentence[] = [];
        let startIdx = 0;
        for (const ending of endings) {
            const endIdx = Math.min(ending.wordIndex, words.length - 1);
            if (endIdx < startIdx) continue;
            const sentenceWords = words.slice(startIdx, endIdx + 1);
            const text = sentenceWords.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
            if (!text) {
                startIdx = endIdx + 1;
                continue;
            }

            const avgConfidence =
                sentenceWords.reduce((sum, w) => sum + (w.confidence ?? 0.8), 0) /
                sentenceWords.length;
            results.push({
                text,
                startTime: sentenceWords[0].start,
                endTime: sentenceWords[sentenceWords.length - 1].end,
                confidence: avgConfidence,
            });
            startIdx = endIdx + 1;
        }

        return results;
    }

    private tokensToWords(tokens: TimelineToken[]): DetectorWord[] {
        if (!tokens.length) return [];

        const words: DetectorWord[] = [];
        let currentText = '';
        let start = 0;
        let end = 0;
        let confidenceAcc = 0;
        let confidenceCount = 0;

        const flush = () => {
            const text = currentText.trim();
            if (!text) return;
            words.push({
                text,
                start,
                end,
                confidence:
                    confidenceCount > 0 ? confidenceAcc / confidenceCount : 0.8,
            });
        };

        for (const tok of tokens) {
            const piece = tok.text || '';
            if (!piece) continue;
            const clean = piece.replace(/^▁/, '');
            const startsWord = piece.startsWith('▁');

            if (startsWord && currentText) {
                flush();
                currentText = '';
                confidenceAcc = 0;
                confidenceCount = 0;
            }

            if (!currentText) {
                start = tok.startTime;
            }
            end = tok.endTime;
            currentText += clean;

            if (typeof tok.logProb === 'number') {
                const conf = Math.max(0.01, Math.min(0.999, Math.exp(tok.logProb)));
                confidenceAcc += conf;
                confidenceCount += 1;
            }

            if (/[.?!]$/.test(clean)) {
                flush();
                currentText = '';
                confidenceAcc = 0;
                confidenceCount = 0;
            }
        }

        if (currentText) flush();
        return words;
    }
}

export default TokenTimelineEngine;
