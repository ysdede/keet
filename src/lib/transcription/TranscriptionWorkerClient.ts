/**
 * Keet v1.1 - Transcription Worker Client
 * 
 * Main thread bridge to the Transcription Web Worker.
 * Offloads heavy AI transcription to a background thread to prevent UI stutters.
 *
 * Supports both v3 (token-stream) and v4 (utterance-based) pipelines.
 */

import type {
    ModelState,
    ModelProgress,
    TranscriptionResult,
    TranscriptionServiceConfig,
    ModelBackendMode,
    QuantizationMode,
} from './types';
import { TokenStreamResult, TokenStreamConfig } from './TokenStreamTranscriber';
import type { MergerResult, UtteranceBasedMergerConfig } from './UtteranceBasedMerger';

/** Finalized sentence emitted by the v4 merger for UI/log rendering */
export interface V4SentenceEntry {
    id: string;
    text: string;
    startTime: number;
    endTime: number;
    emittedAt: number;
}

/** Result from v4 utterance-based processing */
export interface V4ProcessResult {
    matureText: string;
    immatureText: string;
    matureCursorTime: number;
    fullText: string;
    metrics?: any;
    totalSentences: number;
    matureSentenceCount: number;
    pendingSentence: string | null;
    stats: any;
    matureSentences: V4SentenceEntry[];
}

/** Incremental cache parameters for v4 transcription */
export interface V4IncrementalCache {
    cacheKey: string;
    prefixSeconds: number;
}

export interface InitModelOptions {
    modelId?: string;
    cpuThreads?: number;
    backend?: ModelBackendMode;
    encoderQuant?: QuantizationMode;
    decoderQuant?: QuantizationMode;
}

export interface InitLocalModelOptions {
    cpuThreads?: number;
    backend?: ModelBackendMode;
}

/** Valid message types for the worker bridge */
export interface WorkerMessageMap {
    INIT_MODEL: { payload: InitModelOptions; response: void };
    LOAD_LOCAL_MODEL: { payload: { files: File[]; cpuThreads?: number; backend?: ModelBackendMode }; response: void };
    INIT_SERVICE: { payload: { config: TranscriptionServiceConfig }; response: void };
    INIT_V3_SERVICE: { payload: { config: TokenStreamConfig }; response: void };
    PROCESS_CHUNK: { payload: Float32Array; response: TranscriptionResult };
    PROCESS_V3_CHUNK: { payload: { audio: Float32Array; startTime?: number }; response: TokenStreamResult };
    PROCESS_V3_CHUNK_WITH_FEATURES: {
        payload: {
            features: Float32Array;
            T: number;
            melBins: number;
            startTime?: number;
            overlapSeconds?: number;
        };
        response: TokenStreamResult;
    };
    TRANSCRIBE_SEGMENT: { payload: Float32Array; response: TranscriptionResult };
    RESET: { payload: void; response: void };
    FINALIZE: { payload: void; response: TranscriptionResult | TokenStreamResult | MergerResult | { text: string } };
    INIT_V4_SERVICE: { payload: { config: Partial<UtteranceBasedMergerConfig> }; response: void };
    PROCESS_V4_CHUNK_WITH_FEATURES: {
        payload: {
            features: Float32Array;
            T: number;
            melBins: number;
            frameStride?: number;
            timeOffset?: number;
            endTime?: number;
            segmentId?: string;
            incrementalCache?: V4IncrementalCache;
        };
        response: V4ProcessResult;
    };
    V4_FINALIZE_TIMEOUT: { payload: void; response: V4ProcessResult | null };
    V4_RESET: { payload: void; response: void };
}
export class TranscriptionWorkerClient {
    private worker: Worker;
    private messageId = 0;
    private pendingPromises: Map<number, { resolve: Function; reject: Function }> = new Map();

    // Callbacks for reactive updates
    public onModelProgress?: (p: ModelProgress) => void;
    public onModelStateChange?: (s: ModelState) => void;
    public onV3Confirmed?: (text: string, words: any[]) => void;
    public onV3Pending?: (text: string, words: any[]) => void;
    public onError?: (msg: string) => void;

    constructor() {
        // Create the worker
        this.worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (e) => this.handleMessage(e.data);
        this.worker.onerror = (e) => {
            console.error('[TranscriptionWorkerClient] Fatal Worker Error:', e);
            this.onError?.('Fatal background worker error');
        };
    }

    private handleMessage(data: any) {
        const { type, payload, id } = data;

        // Handle promise resolutions
        if (id !== undefined && this.pendingPromises.has(id)) {
            const { resolve, reject } = this.pendingPromises.get(id)!;
            this.pendingPromises.delete(id);

            if (type === 'ERROR') {
                reject(new Error(payload));
            } else {
                resolve(payload);
            }
            return;
        }

        // Handle reactive notifications
        switch (type) {
            case 'MODEL_PROGRESS':
                this.onModelProgress?.(payload);
                break;
            case 'MODEL_STATE':
                this.onModelStateChange?.(payload);
                break;
            case 'V3_CONFIRMED':
                this.onV3Confirmed?.(payload.text, payload.words);
                break;
            case 'V3_PENDING':
                this.onV3Pending?.(payload.text, payload.words);
                break;
            case 'ERROR':
                this.onError?.(payload);
                break;
        }
    }

    private sendRequest<T extends keyof WorkerMessageMap>(
        type: T,
        payload?: WorkerMessageMap[T]['payload'],
        transfer?: Transferable[]
    ): Promise<WorkerMessageMap[T]['response']> {
        const id = this.messageId++;
        return new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ type, payload, id }, transfer || []);
        });
    }

    private transferList(buffer: ArrayBufferLike, transferOwnership?: boolean): Transferable[] {
        return transferOwnership === false ? [] : [buffer as ArrayBuffer];
    }

    private normalizeCpuThreads(cpuThreads?: number): number | undefined {
        if (!Number.isFinite(cpuThreads)) return undefined;
        return Math.max(1, Math.floor(cpuThreads as number));
    }

    // API Methods
    async initModel(options: InitModelOptions = {}): Promise<void> {
        return this.sendRequest('INIT_MODEL', {
            ...options,
            cpuThreads: this.normalizeCpuThreads(options.cpuThreads),
        });
    }

    async initLocalModel(files: FileList | File[], options: InitLocalModelOptions = {}): Promise<void> {
        return this.sendRequest('LOAD_LOCAL_MODEL', {
            files: Array.from(files),
            cpuThreads: this.normalizeCpuThreads(options.cpuThreads),
            backend: options.backend,
        });
    }

    async initService(config: TranscriptionServiceConfig): Promise<void> {
        return this.sendRequest('INIT_SERVICE', { config });
    }

    async initV3Service(config: TokenStreamConfig): Promise<void> {
        return this.sendRequest('INIT_V3_SERVICE', { config });
    }

    /**
     * Default behavior transfers `audio.buffer` to worker ownership.
     * Pass `transferOwnership: false` when the caller must keep using `audio`.
     */
    async processChunk(audio: Float32Array, options: { transferOwnership?: boolean } = {}): Promise<TranscriptionResult> {
        return this.sendRequest('PROCESS_CHUNK', audio, this.transferList(audio.buffer, options.transferOwnership));
    }

    /**
     * Default behavior transfers `audio.buffer` to worker ownership.
     * Pass `transferOwnership: false` when the caller must keep using `audio`.
     */
    async processV3Chunk(
        audio: Float32Array,
        startTime?: number,
        options: { transferOwnership?: boolean } = {},
    ): Promise<TokenStreamResult> {
        return this.sendRequest('PROCESS_V3_CHUNK', { audio, startTime }, this.transferList(audio.buffer, options.transferOwnership));
    }

    /**
     * Process a chunk using pre-computed mel features (from mel worker).
     * Bypasses the preprocessor in the inference worker entirely.
     */
    async processV3ChunkWithFeatures(
        features: Float32Array,
        T: number,
        melBins: number,
        startTime?: number,
        overlapSeconds?: number,
        options: { transferOwnership?: boolean } = {},
    ): Promise<TokenStreamResult> {
        return this.sendRequest('PROCESS_V3_CHUNK_WITH_FEATURES', {
            features, T, melBins, startTime, overlapSeconds,
        }, this.transferList(features.buffer, options.transferOwnership));
    }

    /**
     * Default behavior transfers `audio.buffer` to worker ownership.
     * Pass `transferOwnership: false` when the caller must keep using `audio`.
     */
    async transcribeSegment(audio: Float32Array, options: { transferOwnership?: boolean } = {}): Promise<TranscriptionResult> {
        return this.sendRequest('TRANSCRIBE_SEGMENT', audio, this.transferList(audio.buffer, options.transferOwnership));
    }

    async reset(): Promise<void> {
        return this.sendRequest('RESET');
    }

    async finalize(): Promise<TranscriptionResult | TokenStreamResult | MergerResult | { text: string }> {
        return this.sendRequest('FINALIZE');
    }

    // ---- v4 Utterance-based pipeline methods ----

    /**
     * Initialize the v4 utterance-based merger in the worker.
     */
    async initV4Service(config?: Partial<UtteranceBasedMergerConfig>): Promise<void> {
        return this.sendRequest('INIT_V4_SERVICE', { config: config || {} });
    }

    /**
     * Process a chunk using pre-computed mel features through the v4 pipeline.
     * Transcribes via parakeet.js, then feeds into UtteranceBasedMerger.
     */
    async processV4ChunkWithFeatures(params: {
        features: Float32Array;
        T: number;
        melBins: number;
        frameStride?: number;
        timeOffset?: number;
        endTime?: number;
        segmentId?: string;
        incrementalCache?: V4IncrementalCache;
        transferOwnership?: boolean;
    }): Promise<V4ProcessResult> {
        const { transferOwnership, ...payload } = params;
        return this.sendRequest(
            'PROCESS_V4_CHUNK_WITH_FEATURES',
            payload,
            this.transferList(payload.features.buffer, transferOwnership),
        );
    }

    /**
     * Trigger timeout-based finalization of the pending sentence in the merger.
     * Call this when VAD detects extended silence.
     */
    async v4FinalizeTimeout(): Promise<V4ProcessResult | null> {
        return this.sendRequest('V4_FINALIZE_TIMEOUT');
    }

    /**
     * Reset the v4 merger state.
     */
    async v4Reset(): Promise<void> {
        return this.sendRequest('V4_RESET');
    }

    dispose() {
        this.worker.terminate();
        this.pendingPromises.clear();
    }
}

