/**
 * Keet v1.1 - Type Definitions
 * 
 * Core types for the transcription application.
 * Based on architecture.md specifications.
 */

// ============================================
// Audio Types
// ============================================

/** Audio capture and chunking configuration. */
export interface AudioConfig {
  /** Input sample rate in Hz (typically 16000). */
  sampleRate: number;
  /** Number of channels (mono = 1). */
  channels: number;
  /** Chunk size in samples (frame-aligned to VAD/transcription windows). */
  chunkSize: number;
}

/** A captured PCM audio chunk with timing metadata. */
export interface AudioChunk {
  /** Mono PCM samples. */
  samples: Float32Array;
  /** Absolute capture timestamp in ms. */
  timestamp: number;
  /** Chunk duration in ms. */
  duration: number;
}

// ============================================
// VAD Types
// ============================================

/** Voice activity decision for a chunk/window. */
export interface VADResult {
  /** Whether speech is detected. */
  isSpeech: boolean;
  /** RMS energy in the range 0-1. */
  energy: number;
  /** Detection timestamp in ms. */
  timestamp: number;
}

/** Runtime configuration for energy-based VAD. */
export interface VADConfig {
  /** Energy threshold for speech activation. */
  energyThreshold: number;
  /** Minimum speech duration in ms before activation. */
  minSpeechDuration: number;
  /** Minimum silence duration in ms before deactivation. */
  minSilenceDuration: number;
}

// ============================================
// Transcription Types
// ============================================

/** Transcript payload emitted by transcription pipeline stages. */
export interface TranscriptionResult {
  /** Transcript text for this result. */
  text: string;
  /** Token-level details. */
  tokens: Token[];
  /** Whether the result is finalized. */
  isFinal: boolean;
  /** Emission timestamp in ms. */
  timestamp: number;
}

/** Token span with timing and confidence metadata. */
export interface Token {
  /** Token text as emitted by decoder/tokenizer. */
  text: string;
  /** Start timestamp in seconds. */
  startTime: number;
  /** End timestamp in seconds. */
  endTime: number;
  /** Confidence score in the range 0-1. */
  confidence: number;
}

/** Opaque decoder runtime state for stateful streaming. */
export interface DecoderState {
  // Opaque state from parakeet.js
  // LSTM hidden/cell states for stateful streaming
  [key: string]: unknown;
}

// ============================================
// App State Types
// ============================================

/** Recording lifecycle state for UI and pipeline control. */
export type RecordingState = 'idle' | 'recording' | 'paused';
/** Model loading lifecycle state. */
export type ModelState = 'unloaded' | 'loading' | 'ready' | 'error';
/** Inference backend selected at runtime. */
export type BackendType = 'webgpu' | 'wasm';

/** High-level application state used by UI surfaces. */
export interface AppState {
  /** Recorder lifecycle state. */
  recording: RecordingState;
  /** Model loading lifecycle state. */
  model: ModelState;
  /** Active backend name. */
  backend: BackendType;
  /** Current transcript string. */
  transcript: string;
  /** Active session duration in seconds. */
  sessionDuration: number;
  /** Whether offline-ready assets are available. */
  isOfflineReady: boolean;
}

// ============================================
// Component Props Types
// ============================================

/** Props for transcript panel controls. */
export interface TranscriptPanelProps {
  /** Transcript text to display. */
  transcript: string;
  /** Whether recording is active. */
  isRecording: boolean;
  /** Copies transcript to clipboard. */
  onCopy: () => void;
  /** Clears current transcript content. */
  onClear: () => void;
}

/** Props for waveform display components. */
export interface WaveformProps {
  /** Normalized audio level in the range 0-1. */
  audioLevel: number;
  /** Whether recording is active. */
  isRecording: boolean;
}

/** Props for recording toggle button components. */
export interface RecordButtonProps {
  /** Whether recording is active. */
  isRecording: boolean;
  /** Toggles recording state. */
  onToggle: () => void;
  /** Disables interaction when true. */
  disabled: boolean;
}

