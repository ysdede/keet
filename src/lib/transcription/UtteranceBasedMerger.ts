/**
 * UtteranceBasedMerger.ts
 *
 * Fast-merger parity implementation aligned with:
 * `zdasr-onnx-main/src/zdasr/merger/fast_impl.py`
 *
 * Core behavior:
 * - Each process() call is a full-window replacement for immature text.
 * - Sentence splitting runs on current window text.
 * - All sentences except the last are considered finalization candidates.
 * - Finalized sentence dedup uses (normalized text + end-time tolerance).
 * - Mature cursor advances to end of the last newly finalized sentence.
 * - flush/timeout finalization only finalizes punctuation-complete pending text.
 */

import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

// ---- Public types ----

/** A word from the ASR result (parakeet.js format) */
export interface ASRWord {
    text: string;
    start_time: number;
    end_time: number;
    confidence?: number;
}

/** An ASR result to feed into the merger */
export interface ASRResult {
    utterance_text: string;
    words?: ASRWord[];
    timestamp?: number;
    segment_id?: string;
    end_time?: number;
}

/** A finalized or pending sentence */
export interface MergerSentence {
    id: string;
    text: string;
    startTime: number;
    endTime: number;
    startWordIndex: number;
    endWordIndex: number;
    wordCount: number;
    words: {
        text: string;
        start: number;
        end: number;
        wordIndex?: number;
        confidence?: number;
    }[];
    detectionMethod: string;
    isMature: boolean;
    utteranceId?: string;
    timestamp?: number;
    wordEndTime?: number;
    sentenceEndingWord?: {
        text: string;
        start: number;
        end: number;
        wordIndex: number;
        sentenceMetadata?: {
            sentenceText: string;
            detectionMethod: 'nlp' | 'heuristic';
        };
    };
}

/** The result returned from processASRResult */
export interface MergerResult {
    matureText: string;
    currentText: string;
    fullText: string;
    immatureText: string;
    matureCursorTime: number;
    totalSentences: number;
    matureSentences: MergerSentence[];
    allMatureSentences: MergerSentence[];
    pendingSentence: MergerSentence | null;
    usedPreciseTimestamps: boolean;
    stats: MergerStats;
    utteranceCount: number;
    lastUtteranceText: string;
}

/** Statistics for the merger */
export interface MergerStats {
    utterancesProcessed: number;
    sentencesDetected: number;
    matureSentencesCreated: number;
    matureCursorUpdates: number;
}

/** Configuration for UtteranceBasedMerger */
export interface UtteranceBasedMergerConfig {
    debug: boolean;
    useNLP: boolean;
    minSentenceLength: number;
    requireFollowingSentence: boolean;
    matureSentenceOffset: number;
    skipEmptyUtterances: boolean;
    skipSingleSentences: boolean;
    enableTimeoutFinalization: boolean;
    finalizeTimeoutMs: number;
    dedupToleranceSec: number;
}

interface InternalWord {
    text: string;
    start_time: number;
    end_time: number;
    confidence: number;
    finalized: boolean;
    stability_counter: number;
}

interface FinalizedSentenceMeta {
    text: string;
    start_time: number;
    end_time: number;
}

interface CreateResultContext {
    totalSentences?: number;
    matureSentences?: MergerSentence[];
    usedPreciseTimestamps?: boolean;
}

const SENTENCE_END_RE = /[.!?]$/;

/** Merges utterance-level ASR outputs into mature and immature sentence streams. */
export class UtteranceBasedMerger {
    private config: UtteranceBasedMergerConfig;
    private nlp: any | null = null;

    // Fast-merger state parity
    private mergedTranscript: InternalWord[] = []; // finalized only
    private lastImmatureWords: InternalWord[] = []; // current pending tail
    private matureCursorTime = 0;
    private finalizedSentencesMeta: FinalizedSentenceMeta[] = [];

    // UI-facing state
    private matureSentences: MergerSentence[] = [];
    private pendingSentence: MergerSentence | null = null;
    private currentUtteranceText = '';
    private utteranceCount = 0;
    private sentenceSequence = 0;

    private stats: MergerStats = {
        utterancesProcessed: 0,
        sentencesDetected: 0,
        matureSentencesCreated: 0,
        matureCursorUpdates: 0,
    };

    constructor(config: Partial<UtteranceBasedMergerConfig> = {}) {
        this.config = {
            debug: false,
            useNLP: true,
            minSentenceLength: 1,
            requireFollowingSentence: true,
            matureSentenceOffset: -2,
            skipEmptyUtterances: false,
            skipSingleSentences: false,
            enableTimeoutFinalization: true,
            finalizeTimeoutMs: 2000,
            dedupToleranceSec: 0.15,
            ...config,
        };
        this.initializeNLP();
    }

    private initializeNLP(): void {
        if (!this.config.useNLP) {
            this.nlp = null;
            return;
        }
        try {
            this.nlp = winkNLP(model, ['sbd']);
        } catch (error) {
            this.nlp = null;
            if (this.config.debug) {
                console.warn('[UtteranceMerger] NLP init failed, using heuristic splitter:', error);
            }
        }
    }

    private normalizeWords(words?: ASRWord[]): InternalWord[] {
        if (!Array.isArray(words)) return [];
        return words
            .map((w) => ({
                text: String(w?.text ?? '').trim(),
                start_time: Number(w?.start_time ?? 0),
                end_time: Number(w?.end_time ?? 0),
                confidence: Number.isFinite(Number(w?.confidence))
                    ? Math.max(0, Math.min(1, Number(w?.confidence)))
                    : 1.0,
                finalized: false,
                stability_counter: 0,
            }))
            .filter((w) => w.text.length > 0)
            .map((w) => ({
                ...w,
                start_time: Math.max(0, w.start_time),
                end_time: Math.max(w.start_time, w.end_time),
            }));
    }

    private joinWords(words: InternalWord[]): string {
        return words.map((w) => w.text).join(' ').trim();
    }

    private normalizeForBoundary(value: string): string {
        return value.replace(/\s+/g, '').toLowerCase();
    }

    private mapSentencesToWordBoundaries(words: InternalWord[], sentences: string[]): number[] {
        const boundaries: number[] = [];
        let wordIdx = 0;

        for (const sentence of sentences) {
            const sentenceClean = this.normalizeForBoundary(sentence);
            let accumulated = '';

            for (let i = wordIdx; i < words.length; i++) {
                accumulated += this.normalizeForBoundary(words[i].text);
                if (accumulated.length >= sentenceClean.length) {
                    wordIdx = i + 1;
                    break;
                }
            }

            boundaries.push(wordIdx);
        }

        return boundaries;
    }

    private splitSentences(text: string): { sentences: string[]; detectionMethod: 'nlp' | 'heuristic' } {
        const trimmed = text.trim();
        if (!trimmed) {
            return { sentences: [], detectionMethod: this.nlp ? 'nlp' : 'heuristic' };
        }

        if (this.nlp) {
            try {
                const doc = this.nlp.readDoc(trimmed);
                const sentenceTexts: string[] = doc.sentences().out();
                const cleaned = sentenceTexts
                    .map((s) => String(s).trim())
                    .filter((s) => s.length > 0);
                if (cleaned.length > 0) {
                    return { sentences: cleaned, detectionMethod: 'nlp' };
                }
            } catch (error) {
                if (this.config.debug) {
                    console.warn('[UtteranceMerger] NLP split failed, fallback to heuristic:', error);
                }
            }
        }

        const heuristic = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
        return {
            sentences: heuristic.map((s) => s.trim()).filter((s) => s.length > 0),
            detectionMethod: 'heuristic',
        };
    }

    private isDuplicateSentence(text: string, endTime: number): boolean {
        const norm = text.trim().toLowerCase();
        for (const sentence of this.finalizedSentencesMeta) {
            if (
                sentence.text.trim().toLowerCase() === norm &&
                Math.abs(sentence.end_time - endTime) < this.config.dedupToleranceSec
            ) {
                return true;
            }
        }
        return false;
    }

    private createSentenceFromWords(
        words: InternalWord[],
        isMature: boolean,
        detectionMethod: 'nlp' | 'heuristic',
        startWordIndex: number,
        utteranceId?: string,
        timestamp?: number,
    ): MergerSentence | null {
        if (words.length === 0) return null;
        const text = this.joinWords(words);
        if (!text) return null;
        const startTime = words[0].start_time;
        const endTime = words[words.length - 1].end_time;
        const endWordIndex = startWordIndex + words.length - 1;
        return {
            id: `sentence_${this.sentenceSequence++}`,
            text,
            startTime,
            endTime,
            startWordIndex,
            endWordIndex,
            wordCount: words.length,
            words: words.map((w, idx) => ({
                text: w.text,
                start: w.start_time,
                end: w.end_time,
                confidence: w.confidence,
                wordIndex: startWordIndex + idx,
            })),
            detectionMethod,
            isMature,
            utteranceId,
            timestamp,
            wordEndTime: endTime,
        };
    }

    private appendFinalizedSentence(
        text: string,
        finalizedWords: InternalWord[],
        startWordIndex: number,
        detectionMethod: 'nlp' | 'heuristic',
        utteranceId?: string,
        timestamp?: number,
    ): MergerSentence | null {
        if (finalizedWords.length === 0) return null;
        const startTime = finalizedWords[0].start_time;
        const endTime = finalizedWords[finalizedWords.length - 1].end_time;

        this.finalizedSentencesMeta.push({
            text,
            start_time: startTime,
            end_time: endTime,
        });
        this.stats.matureSentencesCreated++;

        const sentence = this.createSentenceFromWords(
            finalizedWords,
            true,
            detectionMethod,
            startWordIndex,
            utteranceId,
            timestamp,
        );
        if (sentence) {
            this.matureSentences.push(sentence);
        }
        return sentence;
    }

    private updatePendingSentence(): void {
        const startWordIndex = this.mergedTranscript.length;
        this.pendingSentence = this.createSentenceFromWords(
            this.lastImmatureWords,
            false,
            this.nlp ? 'nlp' : 'heuristic',
            startWordIndex,
        );
    }

    /**
     * Process one full ASR window.
     */
    processASRResult(asrResult: ASRResult): MergerResult {
        this.stats.utterancesProcessed++;
        this.utteranceCount++;

        const incomingWords = this.normalizeWords(asrResult.words);
        if (incomingWords.length === 0) {
            return this.createResult({
                totalSentences: 0,
                matureSentences: [],
                usedPreciseTimestamps: false,
            });
        }

        this.currentUtteranceText = this.joinWords(incomingWords);

        const split = this.splitSentences(this.currentUtteranceText);
        const sentences = split.sentences;
        this.stats.sentencesDetected += sentences.length;

        const maturedThisCall: MergerSentence[] = [];

        if (sentences.length > 1) {
            const boundaries = this.mapSentencesToWordBoundaries(incomingWords, sentences);
            let prevIdx = 0;
            let lastConsumedIdx = 0;

            for (let sentenceIdx = 0; sentenceIdx < sentences.length - 1; sentenceIdx++) {
                const endIdx = boundaries[sentenceIdx] ?? prevIdx;
                const sentenceWords = incomingWords.slice(prevIdx, endIdx);
                prevIdx = endIdx;

                if (sentenceWords.length === 0) continue;

                const joined = this.joinWords(sentenceWords);
                const sentenceEnd = sentenceWords[sentenceWords.length - 1].end_time;

                if (this.isDuplicateSentence(joined, sentenceEnd)) {
                    lastConsumedIdx = endIdx;
                    continue;
                }

                const finalizedWords = sentenceWords.map((w) => ({ ...w, finalized: true }));
                const startWordIndex = this.mergedTranscript.length;
                this.mergedTranscript.push(...finalizedWords);

                const matureSentence = this.appendFinalizedSentence(
                    joined,
                    finalizedWords,
                    startWordIndex,
                    split.detectionMethod,
                    asrResult.segment_id,
                    asrResult.timestamp,
                );
                if (matureSentence) {
                    maturedThisCall.push(matureSentence);
                }

                if (sentenceEnd > this.matureCursorTime) {
                    this.matureCursorTime = sentenceEnd;
                    this.stats.matureCursorUpdates++;
                }

                lastConsumedIdx = endIdx;
            }

            this.lastImmatureWords = incomingWords
                .slice(lastConsumedIdx)
                .map((w) => ({ ...w, finalized: false }));
        } else if (sentences.length === 1) {
            const singleText = this.joinWords(incomingWords);
            const singleEnd = incomingWords[incomingWords.length - 1].end_time;
            if (this.isDuplicateSentence(singleText, singleEnd)) {
                this.lastImmatureWords = [];
            } else {
                this.lastImmatureWords = incomingWords.map((w) => ({ ...w, finalized: false }));
            }
        } else {
            this.lastImmatureWords = incomingWords.map((w) => ({ ...w, finalized: false }));
        }

        this.updatePendingSentence();

        return this.createResult({
            totalSentences: sentences.length,
            matureSentences: maturedThisCall,
            usedPreciseTimestamps: true,
        });
    }

    /**
     * Timeout/silence flush. Mirrors fast_impl.flush():
     * - only finalize when pending text ends with [.?!]
     * - dedup-guarded
     */
    finalizePendingSentenceByTimeout(): MergerResult | null {
        if (!this.config.enableTimeoutFinalization) return null;
        if (this.lastImmatureWords.length === 0) return null;

        const pendingText = this.joinWords(this.lastImmatureWords);
        if (!this.isSentenceCompleteByPunctuation(pendingText)) return null;

        const pendingEnd = Math.max(...this.lastImmatureWords.map((w) => w.end_time));
        if (this.isDuplicateSentence(pendingText, pendingEnd)) {
            this.lastImmatureWords = [];
            this.pendingSentence = null;
            return null;
        }

        const finalizedWords = this.lastImmatureWords.map((w) => ({ ...w, finalized: true }));
        const startWordIndex = this.mergedTranscript.length;
        this.mergedTranscript.push(...finalizedWords);

        const matured = this.appendFinalizedSentence(
            pendingText,
            finalizedWords,
            startWordIndex,
            this.nlp ? 'nlp' : 'heuristic',
        );

        this.lastImmatureWords = [];
        this.pendingSentence = null;

        if (pendingEnd > this.matureCursorTime) {
            this.matureCursorTime = pendingEnd;
            this.stats.matureCursorUpdates++;
        }

        return this.createResult({
            totalSentences: 1,
            matureSentences: matured ? [matured] : [],
            usedPreciseTimestamps: true,
        });
    }

    /**
     * Parity helper with fast_impl.force_finalize_all().
     */
    forceFinalizeAll(): void {
        if (this.lastImmatureWords.length === 0) return;

        const pendingText = this.joinWords(this.lastImmatureWords);
        const pendingEnd = Math.max(...this.lastImmatureWords.map((w) => w.end_time));

        if (this.isDuplicateSentence(pendingText, pendingEnd)) {
            this.lastImmatureWords = [];
            this.pendingSentence = null;
            return;
        }

        const finalizedWords = this.lastImmatureWords.map((w) => ({ ...w, finalized: true }));
        const startWordIndex = this.mergedTranscript.length;
        this.mergedTranscript.push(...finalizedWords);
        this.appendFinalizedSentence(
            pendingText,
            finalizedWords,
            startWordIndex,
            this.nlp ? 'nlp' : 'heuristic',
        );

        this.lastImmatureWords = [];
        this.pendingSentence = null;

        if (pendingEnd > this.matureCursorTime) {
            this.matureCursorTime = pendingEnd;
            this.stats.matureCursorUpdates++;
        }
    }

    isSentenceCompleteByPunctuation(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        const trimmed = text.trim();
        if (!trimmed) return false;
        if (trimmed.endsWith('...')) return false;
        return SENTENCE_END_RE.test(trimmed);
    }

    getMatureText(): string {
        return this.joinWords(this.mergedTranscript);
    }

    getCurrentText(): string {
        return this.currentUtteranceText;
    }

    getImmatureText(): string {
        return this.joinWords(this.lastImmatureWords);
    }

    getFullText(): string {
        const mature = this.getMatureText();
        const immature = this.getImmatureText();
        if (mature && immature) return `${mature} ${immature}`.trim();
        return mature || immature || '';
    }

    getMatureCursorTime(): number {
        return this.matureCursorTime;
    }

    getPendingSentence(): MergerSentence | null {
        return this.pendingSentence;
    }

    private createResult(context: CreateResultContext = {}): MergerResult {
        return {
            matureText: this.getMatureText(),
            currentText: this.getCurrentText(),
            fullText: this.getFullText(),
            immatureText: this.getImmatureText(),
            matureCursorTime: this.matureCursorTime,
            totalSentences: context.totalSentences ?? 0,
            matureSentences: context.matureSentences ?? [],
            allMatureSentences: [...this.matureSentences],
            pendingSentence: this.pendingSentence,
            usedPreciseTimestamps: context.usedPreciseTimestamps ?? false,
            stats: { ...this.stats },
            utteranceCount: this.utteranceCount,
            lastUtteranceText: this.currentUtteranceText,
        };
    }

    reset(): void {
        this.mergedTranscript = [];
        this.lastImmatureWords = [];
        this.matureCursorTime = 0;
        this.finalizedSentencesMeta = [];
        this.matureSentences = [];
        this.pendingSentence = null;
        this.currentUtteranceText = '';
        this.utteranceCount = 0;
        this.sentenceSequence = 0;
        this.stats = {
            utterancesProcessed: 0,
            sentencesDetected: 0,
            matureSentencesCreated: 0,
            matureCursorUpdates: 0,
        };
    }

    updateConfig(newConfig: Partial<UtteranceBasedMergerConfig>): void {
        const previousUseNlp = this.config.useNLP;
        this.config = { ...this.config, ...newConfig };
        if (previousUseNlp !== this.config.useNLP || this.nlp === null) {
            this.initializeNLP();
        }
    }

    getStats(): MergerStats & {
        sentenceDetectorStats: {
            nlpAvailable: boolean;
            usingNLP: boolean;
            cacheSize: number;
            maxCacheSize: number;
        };
        matureSentenceCount: number;
        utteranceCount: number;
    } {
        return {
            ...this.stats,
            sentenceDetectorStats: {
                nlpAvailable: !!this.nlp,
                usingNLP: this.config.useNLP && !!this.nlp,
                cacheSize: 0,
                maxCacheSize: 0,
            },
            matureSentenceCount: this.matureSentences.length,
            utteranceCount: this.utteranceCount,
        };
    }
}

export default UtteranceBasedMerger;
