/**
 * Keet v1.1 - Transcription Types
 */

/** Model loading lifecycle state. */
export type ModelState = 'unloaded' | 'loading' | 'ready' | 'error';
/** Inference backend name. */
export type BackendType = 'webgpu' | 'wasm';

/** Model selection/configuration payload. */
export interface ModelConfig {
  /** Selected model identifier or key. */
  modelId: string;
  /** Optional backend override. */
  backend?: BackendType;
}


/** Progress event emitted during model initialization and downloads. */
export interface ModelProgress {
  /** Pipeline stage identifier (for example `download`, `compile`). */
  stage: string;
  /** Progress percentage in the range 0-100. */
  progress: number; // 0-100
  /** Human-readable status message. */
  message?: string;
  /** Optional active filename. */
  file?: string;
}

/** Word-level transcription token with optional confidence. */
export interface TranscriptionWord {
  /** Token text. */
  text: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Optional confidence in the range 0-1. */
  confidence?: number;
}

export interface TranscriptionResult {
  /** Current chunk text */
  chunkText: string;
  /** Cumulative full transcript */
  text: string;
  /** Word-level details */
  words: TranscriptionWord[];
  /** Total audio duration processed */
  totalDuration: number;
  /** Whether this is the final result */
  isFinal: boolean;
}

/** Configuration for streaming transcription behavior. */
export interface TranscriptionServiceConfig {
  /** Input sample rate in Hz. */
  sampleRate?: number;
  /** Include word-level timestamps in results. */
  returnTimestamps?: boolean;
  /** Include confidence scores in results. */
  returnConfidences?: boolean;
  /** Enables debug logging. */
  debug?: boolean;
}

/**
 * Callbacks for model loading events
 */
export interface ModelManagerCallbacks {
  onProgress?: (progress: ModelProgress) => void;
  onStateChange?: (state: ModelState) => void;
  onError?: (error: Error) => void;
}

/**
 * Callbacks for transcription events
 */
export interface TranscriptionCallbacks {
  onResult?: (result: TranscriptionResult) => void;
  onError?: (error: Error) => void;
}

