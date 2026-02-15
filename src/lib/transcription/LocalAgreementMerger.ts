/**
 * LocalAgreementMerger
 *
 * TypeScript port of the local-agreement segment merger used in
 * web_transcript_svelte/TranscriptionMerger.js.
 *
 * Canonical state is a sorted merged word timeline. Incoming overlapping
 * segments are reconciled using:
 * - local agreement prefix (word-by-word)
 * - confidence + stability arbitration for disagreement tails
 */

export interface AgreementIncomingWord {
    word: string;
    start: number;
    end: number;
    confidence?: number;
}

export interface AgreementIncomingSegment {
    confidence?: number;
    words: AgreementIncomingWord[];
}

export interface AgreementMergeInput {
    segmentId: string;
    sequence: number;
    segments: AgreementIncomingSegment[];
    endTime?: number;
}

export interface AgreementWordHistory {
    text: string;
    confidence: number;
    start: number;
    end: number;
}

export interface MergedWord {
    id: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
    finalized: boolean;
    sourceSegmentId: string;
    stabilityCounter: number;
    lastModifiedSequence: number;
    history: AgreementWordHistory[];
    lockedByUser: boolean;
}

export interface LocalAgreementStats {
    totalSegmentsProcessed: number;
    totalWordsProcessed: number;
    segmentsDiscarded: number;
    wordsAdded: number;
    wordsReplaced: number;
    wordsKeptStable: number;
    wordsFinalized: number;
}

export interface LocalAgreementState {
    text: string;
    words: MergedWord[];
    stats: LocalAgreementStats;
    matureCursorTime: number;
}

export interface LocalAgreementConfig {
    // Segment comparison and reconciliation
    stabilityThreshold: number;
    confidenceBias: number;
    lengthBiasFactor: number;
    wordConfidenceReplaceThreshold: number;
    minOverlapDurationForRedundancy: number;
    stabilityThresholdForVeto: number;
    wordMinConfidenceSuperiorityForVeto: number;

    // Finalization
    finalizationStabilityThreshold: number;
    finalizationAgeThreshold: number;
    useAgeFinalization: boolean;

    // Segment filtering
    segmentFilterMinAbsoluteConfidence: number;
    segmentFilterStdDevThresholdFactor: number;

    // Mature cursor
    minPauseDurationForCursor: number;
    minInitialContextTime: number;
    cursorBehaviorMode: 'sentenceBased' | 'lastFinalized';

    // Debug
    debug: boolean;
}

interface IncomingWord {
    id: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
    sourceSegmentId: string;
    sequence: number;
}

interface OverlapIndices {
    startIndex: number;
    endIndex: number;
}

type ReplaceDecision =
    | { action: 'add_new' }
    | { action: 'keep' }
    | { action: 'replace_all' }
    | { action: 'partial_replace'; agreementLength: number };

export class LocalAgreementMerger {
    private mergedTranscript: MergedWord[] = [];
    private matureCursorTime = 0;
    private stats: LocalAgreementStats;
    private config: LocalAgreementConfig;
    private readonly defaultConfig: LocalAgreementConfig;

    constructor(config: Partial<LocalAgreementConfig> = {}) {
        this.defaultConfig = {
            stabilityThreshold: 3,
            confidenceBias: 1.15,
            lengthBiasFactor: 0.01,
            wordConfidenceReplaceThreshold: 0.15,
            minOverlapDurationForRedundancy: 0.05,
            stabilityThresholdForVeto: 1,
            wordMinConfidenceSuperiorityForVeto: 0.20,
            finalizationStabilityThreshold: 2,
            finalizationAgeThreshold: 10.0,
            useAgeFinalization: true,
            segmentFilterMinAbsoluteConfidence: 0.20,
            segmentFilterStdDevThresholdFactor: 2.0,
            minPauseDurationForCursor: 0.4,
            minInitialContextTime: 3.0,
            cursorBehaviorMode: 'sentenceBased',
            debug: false,
        };
        this.config = { ...this.defaultConfig, ...config };
        this.stats = this.getInitialStats();
    }

    merge(response: AgreementMergeInput): LocalAgreementState {
        if (!response || !Array.isArray(response.segments) || response.segments.length === 0) {
            return this.getCurrentState();
        }

        this.stats.totalSegmentsProcessed += 1;
        const currentSequence = Number.isFinite(response.sequence) ? response.sequence : this.stats.totalSegmentsProcessed;
        const filteredSegments = this.filterSegmentsByConfidence(response.segments);

        const fallbackEnd =
            Math.max(
                0,
                ...response.segments.flatMap((s) =>
                    (s.words || []).map((w) => (Number.isFinite(w.end) ? w.end : 0))
                )
            );
        const segmentEndTime = Number.isFinite(response.endTime) ? (response.endTime as number) : fallbackEnd;

        if (filteredSegments.length === 0) {
            this.stats.segmentsDiscarded += 1;
            this.updateFinalization(segmentEndTime, currentSequence);
            this.updateMatureCursorTime(segmentEndTime);
            return this.getCurrentState();
        }

        const incomingWords = this.extractWordsFromSegments(
            filteredSegments,
            response.segmentId || `segment_${currentSequence}`,
            currentSequence
        );

        if (incomingWords.length === 0) {
            this.updateFinalization(segmentEndTime, currentSequence);
            this.updateMatureCursorTime(segmentEndTime);
            return this.getCurrentState();
        }

        this.stats.totalWordsProcessed += incomingWords.length;
        const segmentStartTime = incomingWords[0].start;
        const actualSegmentEndTime = incomingWords[incomingWords.length - 1].end;

        const overlapInfo = this.findIndicesInMergedTranscript(segmentStartTime, actualSegmentEndTime);
        const overlappingWords = overlapInfo
            ? this.mergedTranscript.slice(overlapInfo.startIndex, overlapInfo.endIndex + 1)
            : [];

        const decision = this.decideReplacement(incomingWords, overlappingWords, currentSequence);

        let wordsAddedCount = 0;
        let wordsReplacedCount = 0;
        let wordsKeptCount = 0;

        switch (decision.action) {
            case 'add_new': {
                const toInsert = incomingWords.map((w) => this.createMergedWord(w, currentSequence));
                wordsAddedCount += toInsert.length;
                const hint = this.mergedTranscript.length > 0 ? -1 : 0;
                this.insertWordsIntoTranscript(toInsert, hint);
                break;
            }

            case 'keep': {
                wordsKeptCount += overlappingWords.length;
                for (const word of overlappingWords) {
                    if (word.lastModifiedSequence < currentSequence) {
                        word.lastModifiedSequence = currentSequence;
                    }
                }
                break;
            }

            case 'replace_all': {
                let insertionIndex = -1;
                let removedHistory: AgreementWordHistory[] = [];
                if (overlapInfo) {
                    insertionIndex = overlapInfo.startIndex;
                    const removed = this.mergedTranscript.slice(overlapInfo.startIndex, overlapInfo.endIndex + 1);
                    removedHistory = removed.map((w) => ({
                        text: w.text,
                        confidence: w.confidence,
                        start: w.start,
                        end: w.end,
                    }));
                    const removedCount = overlapInfo.endIndex - overlapInfo.startIndex + 1;
                    this.mergedTranscript.splice(overlapInfo.startIndex, removedCount);
                    wordsReplacedCount += removedCount;
                }

                const toInsert = incomingWords.map((w) => this.createMergedWord(w, currentSequence));
                if (toInsert.length > 0 && removedHistory.length > 0) {
                    toInsert[0].history = [...removedHistory, ...toInsert[0].history];
                }
                wordsAddedCount += toInsert.length;
                this.insertWordsIntoTranscript(toInsert, insertionIndex);
                break;
            }

            case 'partial_replace': {
                let insertionIndex = -1;
                let removedHistory: AgreementWordHistory[] = [];

                if (overlapInfo) {
                    if (decision.agreementLength < overlappingWords.length) {
                        const removeIndex = overlapInfo.startIndex + decision.agreementLength;
                        const removeCount = overlappingWords.length - decision.agreementLength;
                        insertionIndex = removeIndex;

                        const removed = this.mergedTranscript.slice(removeIndex, removeIndex + removeCount);
                        removedHistory = removed.map((w) => ({
                            text: w.text,
                            confidence: w.confidence,
                            start: w.start,
                            end: w.end,
                        }));

                        this.mergedTranscript.splice(removeIndex, removeCount);
                        wordsReplacedCount += removeCount;
                        wordsKeptCount += decision.agreementLength;
                    } else {
                        insertionIndex = overlapInfo.startIndex + overlappingWords.length;
                        wordsKeptCount += overlappingWords.length;
                    }
                }

                const tail = incomingWords
                    .slice(decision.agreementLength)
                    .map((w) => this.createMergedWord(w, currentSequence));
                if (tail.length > 0 && removedHistory.length > 0) {
                    tail[0].history = [...removedHistory, ...tail[0].history];
                }
                wordsAddedCount += tail.length;
                if (tail.length > 0) {
                    this.insertWordsIntoTranscript(tail, insertionIndex);
                }

                if (overlapInfo && decision.agreementLength > 0) {
                    const keptExisting = this.mergedTranscript.slice(
                        overlapInfo.startIndex,
                        overlapInfo.startIndex + decision.agreementLength
                    );
                    for (const word of keptExisting) {
                        if (word.lastModifiedSequence < currentSequence) {
                            word.lastModifiedSequence = currentSequence;
                        }
                    }
                }
                break;
            }
        }

        this.stats.wordsAdded += wordsAddedCount;
        this.stats.wordsReplaced += wordsReplacedCount;
        this.stats.wordsKeptStable += wordsKeptCount;

        this.updateFinalization(actualSegmentEndTime, currentSequence);
        this.updateMatureCursorTime(actualSegmentEndTime);

        return this.getCurrentState();
    }

    flush(currentTime: number, currentSequence = this.stats.totalSegmentsProcessed + 1): LocalAgreementState {
        this.updateFinalization(currentTime, currentSequence);
        this.updateMatureCursorTime(currentTime);
        return this.getCurrentState();
    }

    getCurrentState(): LocalAgreementState {
        return {
            text: this.getFinalText(),
            words: [...this.mergedTranscript],
            stats: { ...this.stats },
            matureCursorTime: this.matureCursorTime,
        };
    }

    getMatureCursorTime(): number {
        return this.matureCursorTime;
    }

    updateConfig(newConfig: Partial<LocalAgreementConfig>): void {
        if (!newConfig) return;
        this.config = { ...this.config, ...newConfig };
    }

    reset(config?: Partial<LocalAgreementConfig>): void {
        this.mergedTranscript = [];
        this.matureCursorTime = 0;
        this.stats = this.getInitialStats();
        this.config = { ...this.defaultConfig, ...(config || this.config) };
    }

    private getInitialStats(): LocalAgreementStats {
        return {
            totalSegmentsProcessed: 0,
            totalWordsProcessed: 0,
            segmentsDiscarded: 0,
            wordsAdded: 0,
            wordsReplaced: 0,
            wordsKeptStable: 0,
            wordsFinalized: 0,
        };
    }

    private findIndicesInMergedTranscript(startTime: number, endTime: number): OverlapIndices | null {
        if (this.mergedTranscript.length === 0 || !(endTime > startTime)) return null;

        let low = 0;
        let high = this.mergedTranscript.length - 1;
        let firstPossibleIndex = -1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.mergedTranscript[mid].end > startTime) {
                firstPossibleIndex = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        if (firstPossibleIndex === -1) return null;

        let startIndex = -1;
        let endIndex = -1;
        for (let i = firstPossibleIndex; i < this.mergedTranscript.length; i++) {
            const word = this.mergedTranscript[i];
            if (word.start >= endTime) break;
            if (LocalAgreementMerger.doTimeRangesOverlap(startTime, endTime, word.start, word.end)) {
                if (startIndex === -1) startIndex = i;
                endIndex = i;
            }
        }
        if (startIndex === -1) return null;
        return { startIndex, endIndex };
    }

    private decideReplacement(
        incomingWords: IncomingWord[],
        overlappingWords: MergedWord[],
        currentSequence: number
    ): ReplaceDecision {
        if (overlappingWords.length > 0 && overlappingWords.some((w) => w.lockedByUser)) {
            const agreementLength = this.computeAgreementLength(incomingWords, overlappingWords);
            if (agreementLength > 0) {
                const agreedUnlocked = overlappingWords
                    .slice(0, agreementLength)
                    .filter((w) => !w.lockedByUser);
                this.incrementStability(agreedUnlocked, currentSequence);
            }
            for (const word of overlappingWords) {
                if (word.lastModifiedSequence < currentSequence) {
                    word.lastModifiedSequence = currentSequence;
                }
            }
            return { action: 'keep' };
        }

        if (overlappingWords.length === 0) return { action: 'add_new' };
        if (incomingWords.length === 0) return { action: 'keep' };

        const agreementLength = this.computeAgreementLength(incomingWords, overlappingWords);

        // Collapse boundary duplicates for the same text around agreement edges.
        if (agreementLength > 0 && agreementLength < incomingWords.length) {
            const lastAgreedExistingWord = overlappingWords[agreementLength - 1];
            const nextIncomingWord = incomingWords[agreementLength];

            if (
                lastAgreedExistingWord &&
                nextIncomingWord &&
                lastAgreedExistingWord.text.toLowerCase() === nextIncomingWord.text.toLowerCase()
            ) {
                const overlapDuration = LocalAgreementMerger.calculateOverlapDuration(
                    lastAgreedExistingWord.start,
                    lastAgreedExistingWord.end,
                    nextIncomingWord.start,
                    nextIncomingWord.end
                );

                if (overlapDuration >= this.config.minOverlapDurationForRedundancy) {
                    if (
                        nextIncomingWord.confidence >
                        lastAgreedExistingWord.confidence + this.config.wordConfidenceReplaceThreshold
                    ) {
                        lastAgreedExistingWord.start = nextIncomingWord.start;
                        lastAgreedExistingWord.end = nextIncomingWord.end;
                        lastAgreedExistingWord.confidence = nextIncomingWord.confidence;
                        lastAgreedExistingWord.lastModifiedSequence = currentSequence;
                    } else if (lastAgreedExistingWord.lastModifiedSequence < currentSequence) {
                        lastAgreedExistingWord.lastModifiedSequence = currentSequence;
                    }

                    // Remove the redundant next incoming word in-place so merge actions use the compacted list.
                    incomingWords.splice(agreementLength, 1);
                }
            }
        }

        if (agreementLength >= incomingWords.length) {
            this.incrementStability(overlappingWords.slice(0, agreementLength), currentSequence);
            return { action: 'keep' };
        }

        if (agreementLength > 0) {
            this.incrementStability(overlappingWords.slice(0, agreementLength), currentSequence);

            const incomingTail = incomingWords.slice(agreementLength);
            const existingTail = overlappingWords.slice(agreementLength);

            if (incomingTail.length === 0 && existingTail.length > 0) {
                return { action: 'keep' };
            }
            if (existingTail.length === 0 && incomingTail.length > 0) {
                return { action: 'partial_replace', agreementLength };
            }

            if (incomingTail.length > 0 && existingTail.length > 0) {
                const replaceTail = this.decideReplacementByConfidence(incomingTail, existingTail, currentSequence);
                if (replaceTail) return { action: 'partial_replace', agreementLength };
                this.incrementStability(existingTail, currentSequence);
                return { action: 'keep' };
            }

            return { action: 'keep' };
        }

        const replaceAll = this.decideReplacementByConfidence(
            incomingWords,
            overlappingWords,
            currentSequence
        );
        if (replaceAll) return { action: 'replace_all' };
        this.incrementStability(overlappingWords, currentSequence);
        return { action: 'keep' };
    }

    private computeAgreementLength(incomingWords: IncomingWord[], overlappingWords: MergedWord[]): number {
        const n = Math.min(incomingWords.length, overlappingWords.length);
        let agreementLength = 0;
        for (let i = 0; i < n; i++) {
            if (incomingWords[i].text.toLowerCase() === overlappingWords[i].text.toLowerCase()) {
                agreementLength += 1;
            } else {
                break;
            }
        }
        return agreementLength;
    }

    private incrementStability(wordsToStabilize: MergedWord[], currentSequence: number): number {
        let count = 0;
        for (const word of wordsToStabilize) {
            if (word.lastModifiedSequence < currentSequence) {
                word.stabilityCounter += 1;
                word.lastModifiedSequence = currentSequence;
                count += 1;
            }
        }
        return count;
    }

    private decideReplacementByConfidence(
        incomingWords: Array<IncomingWord | MergedWord>,
        overlappingWords: MergedWord[],
        currentSequence: number
    ): boolean {
        if (!incomingWords || incomingWords.length === 0) return false;
        if (!overlappingWords || overlappingWords.length === 0) return true;

        const avgConfidence = (words: Array<IncomingWord | MergedWord>) => {
            if (!words.length) return 0;
            const sum = words.reduce((acc, w) => acc + (Number(w.confidence) || 0), 0);
            return sum / words.length;
        };

        const incomingAvg = avgConfidence(incomingWords);
        const existingAvg = avgConfidence(overlappingWords);
        const incomingLen = incomingWords.length;
        const existingLen = overlappingWords.length;

        const minExistingStability = overlappingWords.reduce(
            (min, w) => Math.min(min, w.stabilityCounter || 0),
            Number.POSITIVE_INFINITY
        );
        const maxExistingSequence = overlappingWords.reduce(
            (max, w) => Math.max(max, w.lastModifiedSequence || 0),
            0
        );
        const isExistingVeryRecent = maxExistingSequence >= currentSequence - 1;
        const effectiveBias = isExistingVeryRecent ? this.config.confidenceBias * 1.1 : this.config.confidenceBias;

        let preliminaryReplaceDecision = false;
        if (incomingAvg > existingAvg * effectiveBias) {
            preliminaryReplaceDecision = true;
        } else {
            const tolerance =
                existingAvg > 0 ? (effectiveBias - 1.0) * existingAvg : 0.01;
            const diff = Math.abs(incomingAvg - existingAvg);
            if (diff <= tolerance) {
                if (minExistingStability >= this.config.stabilityThreshold && !isExistingVeryRecent) {
                    preliminaryReplaceDecision = false;
                } else {
                    const scoreIncoming = incomingAvg + this.config.lengthBiasFactor * incomingLen;
                    const scoreExisting = existingAvg + this.config.lengthBiasFactor * existingLen;
                    preliminaryReplaceDecision = scoreIncoming > scoreExisting;
                }
            } else if (incomingAvg < existingAvg) {
                if (minExistingStability >= 1 && !isExistingVeryRecent) {
                    preliminaryReplaceDecision = false;
                } else {
                    preliminaryReplaceDecision = true;
                }
            } else {
                preliminaryReplaceDecision = true;
            }
        }

        // Veto replacing stable, clearly higher-confidence existing words with lower-confidence alternatives.
        if (preliminaryReplaceDecision) {
            const vetoCheckLength = Math.min(3, incomingWords.length, overlappingWords.length);
            for (let i = 0; i < vetoCheckLength; i++) {
                const existing = overlappingWords[i];
                const incoming = incomingWords[i];

                if (!existing || !incoming) continue;
                if (existing.text.toLowerCase() === incoming.text.toLowerCase()) continue;

                if (
                    existing.stabilityCounter >= this.config.stabilityThresholdForVeto &&
                    existing.confidence >
                        Number(incoming.confidence || 0) + this.config.wordMinConfidenceSuperiorityForVeto
                ) {
                    return false;
                }
            }
        }

        return preliminaryReplaceDecision;
    }

    private createMergedWord(incomingWord: IncomingWord, currentSequence: number): MergedWord {
        return {
            id: incomingWord.id,
            text: incomingWord.text,
            start: incomingWord.start,
            end: incomingWord.end,
            confidence: incomingWord.confidence,
            finalized: false,
            sourceSegmentId: incomingWord.sourceSegmentId,
            stabilityCounter: 0,
            lastModifiedSequence: currentSequence,
            history: [],
            lockedByUser: false,
        };
    }

    private insertWordsIntoTranscript(wordsToInsert: MergedWord[], insertionHint = -1): void {
        if (!wordsToInsert || wordsToInsert.length === 0) return;

        if (insertionHint !== -1 && insertionHint <= this.mergedTranscript.length) {
            const fitsAtHint =
                (insertionHint === 0 ||
                    this.mergedTranscript[insertionHint - 1].start <= wordsToInsert[0].start) &&
                (insertionHint === this.mergedTranscript.length ||
                    this.mergedTranscript[insertionHint].start >= wordsToInsert[wordsToInsert.length - 1].start);
            if (fitsAtHint) {
                this.mergedTranscript.splice(insertionHint, 0, ...wordsToInsert);
                return;
            }
        }

        const firstStart = wordsToInsert[0].start;
        let low = 0;
        let high = this.mergedTranscript.length - 1;
        let insertionIndex = this.mergedTranscript.length;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.mergedTranscript[mid].start >= firstStart) {
                insertionIndex = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        this.mergedTranscript.splice(insertionIndex, 0, ...wordsToInsert);
    }

    private extractWordsFromSegments(
        filteredSegments: AgreementIncomingSegment[],
        segmentId: string,
        sequence: number
    ): IncomingWord[] {
        const words: IncomingWord[] = [];
        let wordCounter = 0;

        filteredSegments.forEach((segment, segmentIndex) => {
            const segmentConf = Number.isFinite(segment.confidence) ? (segment.confidence as number) : 0;
            for (const word of segment.words || []) {
                const cleanedWord = (word.word || '').trim();
                if (!cleanedWord) continue;

                const startTime = Number(word.start);
                const endTime = Number(word.end);
                if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
                    continue;
                }

                const wordId = `${segmentId}_s${segmentIndex}_w${wordCounter++}_q${sequence}`;
                words.push({
                    id: wordId,
                    text: cleanedWord,
                    start: startTime,
                    end: endTime,
                    confidence: Number.isFinite(word.confidence as number)
                        ? (word.confidence as number)
                        : segmentConf,
                    sourceSegmentId: segmentId,
                    sequence,
                });
            }
        });

        words.sort((a, b) => a.start - b.start);
        return words;
    }

    private updateFinalization(currentTime: number, currentSequence: number): void {
        let changed = 0;
        for (const word of this.mergedTranscript) {
            if (word.finalized) continue;

            let shouldFinalize = false;
            if (this.matureCursorTime > 0 && word.end < this.matureCursorTime - 0.1) {
                shouldFinalize = true;
            }
            if (
                !shouldFinalize &&
                word.stabilityCounter >= this.config.finalizationStabilityThreshold &&
                word.lastModifiedSequence < currentSequence
            ) {
                shouldFinalize = true;
            }
            if (
                !shouldFinalize &&
                this.config.useAgeFinalization &&
                Number.isFinite(currentTime) &&
                currentTime > 0 &&
                currentTime - word.end >= this.config.finalizationAgeThreshold
            ) {
                shouldFinalize = true;
            }

            if (shouldFinalize) {
                word.finalized = true;
                changed += 1;
            }
        }

        if (changed > 0) {
            this.stats.wordsFinalized = this.mergedTranscript.filter((w) => w.finalized).length;
        }
    }

    private updateMatureCursorTime(currentTime: number): void {
        const finalizedWords = this.mergedTranscript.filter((w) => w.finalized);
        if (finalizedWords.length === 0) return;

        const lastFinalizedWordEnd = finalizedWords[finalizedWords.length - 1].end;
        let candidate = lastFinalizedWordEnd;

        if (this.config.cursorBehaviorMode === 'sentenceBased') {
            const sentenceEndings = finalizedWords
                .filter((w) => /[.?!]$/.test(w.text))
                .sort((a, b) => a.end - b.end);

            if (sentenceEndings.length >= 2) {
                candidate = sentenceEndings[sentenceEndings.length - 2].end;
            } else if (sentenceEndings.length === 1) {
                candidate = sentenceEndings[0].end;
            }
        }

        if (this.matureCursorTime === 0 && candidate < this.config.minInitialContextTime && currentTime < this.config.minInitialContextTime) {
            return;
        }
        if (candidate > this.matureCursorTime) {
            this.matureCursorTime = candidate;
        }
    }

    private filterSegmentsByConfidence(segments: AgreementIncomingSegment[]): AgreementIncomingSegment[] {
        if (!segments || segments.length === 0) return [];

        const minAbs = this.config.segmentFilterMinAbsoluteConfidence;
        const stdFactor = this.config.segmentFilterStdDevThresholdFactor;

        if (segments.length === 1) {
            const c = segments[0].confidence;
            return Number.isFinite(c as number) && (c as number) >= minAbs ? segments : [];
        }

        const confidences = segments
            .map((s) => s.confidence)
            .filter((c): c is number => Number.isFinite(c as number));
        if (confidences.length === 0) return [];

        const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        const variance =
            confidences.reduce((acc, c) => acc + (c - mean) * (c - mean), 0) / confidences.length;
        const stdDev = Math.sqrt(variance);
        const dynamic = mean - stdFactor * stdDev;
        const threshold = Number.isFinite(dynamic) ? Math.max(minAbs, dynamic) : minAbs;

        return segments.filter(
            (segment) =>
                Number.isFinite(segment.confidence as number) &&
                (segment.confidence as number) >= threshold
        );
    }

    private getFinalTextFromWords(words: MergedWord[]): string {
        if (!words.length) return '';
        let text = '';
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (!word || typeof word.text !== 'string') continue;

            const current = word.text;
            let needsSpace = false;
            if (i > 0) {
                const prev = words[i - 1];
                if (prev && typeof prev.text === 'string') {
                    needsSpace = true;
                    const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(current);
                    if (noSpaceBefore) needsSpace = false;
                    if (current.startsWith("'")) {
                        const contractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                        if (contractions.includes(current.toLowerCase())) needsSpace = false;
                    }
                    if (current.toLowerCase() === "n't" && prev.text.toLowerCase().endsWith('n')) {
                        needsSpace = false;
                    }
                }
            }
            if (needsSpace) text += ' ';
            text += current;
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    getFinalText(): string {
        return this.getFinalTextFromWords(this.mergedTranscript);
    }

    getStableText(): string {
        return this.getFinalTextFromWords(this.mergedTranscript.filter((w) => w.finalized));
    }

    getDraftText(): string {
        return this.getFinalTextFromWords(this.mergedTranscript.filter((w) => !w.finalized));
    }

    static doTimeRangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
        if (!(start1 < end1) || !(start2 < end2)) return false;
        return Math.max(start1, start2) < Math.min(end1, end2);
    }

    static calculateOverlapDuration(start1: number, end1: number, start2: number, end2: number): number {
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        return Math.max(0, overlapEnd - overlapStart);
    }
}

export default LocalAgreementMerger;
