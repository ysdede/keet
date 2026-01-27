/**
 * VAD (Voice Activity Detection) Module
 * 
 * Provides multiple VAD implementations and smoothing utilities for
 * filtering out silence/noise before ASR transcription.
 * 
 * Available VAD models:
 * - SileroVAD: ONNX-based, well-tested, ~2MB model
 * - TenVAD: WASM-based, lightweight (~277KB), lower latency
 *   https://github.com/TEN-framework/ten-vad
 */

export { SileroVAD, default as SileroVADClass } from './SileroVAD.js';
export { TenVAD, default as TenVADClass } from './TenVAD.js';
export { 
  smoothVADProbabilities, 
  getSpeechBoundaries,
  getSpeechRatio,
  hasSufficientSpeech,
  DEFAULT_VAD_PARAMS 
} from './VADSmoothing.js';

/**
 * VAD model types available
 */
export const VAD_MODELS = {
  SILERO: 'silero',
  TEN: 'ten'
};

/**
 * Create a VAD instance based on the model type.
 * @param {string} modelType - 'silero' or 'ten'
 * @param {Object} options - VAD options
 * @returns {SileroVAD|TenVAD} VAD instance
 */
export function createVAD(modelType, options = {}) {
  switch (modelType) {
    case VAD_MODELS.TEN:
      const { TenVAD } = require('./TenVAD.js');
      return new TenVAD(options);
    case VAD_MODELS.SILERO:
    default:
      const { SileroVAD } = require('./SileroVAD.js');
      return new SileroVAD(options);
  }
}
