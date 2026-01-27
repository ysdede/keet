/**
 * VAD Smoothing and Binarization Utilities
 * 
 * Ported from zdasr-main/src/zdasr/vad_smoothing.py
 * 
 * This module provides post-processing for raw VAD probabilities to reduce
 * flickering and create stable speech regions.
 */

/**
 * @typedef {Object} VADSmoothingParams
 * @property {number} [threshold=0.48] - Speech probability threshold
 * @property {number} [minSpeechMs=240] - Minimum speech duration in ms
 * @property {number} [minSilenceMs=480] - Minimum silence duration in ms
 * @property {number} [padMs=20] - Padding around speech in ms
 * @property {number} [mergeGapMs=560] - Merge gap threshold in ms
 */

/**
 * Default smoothing parameters tuned for streaming ASR.
 */
export const DEFAULT_VAD_PARAMS = {
  threshold: 0.48,
  minSpeechMs: 240,
  minSilenceMs: 480,
  padMs: 20,
  mergeGapMs: 560
};

/**
 * Remove short speech runs from binary array.
 * @param {Uint8Array} binary - Binary speech decisions
 * @param {number} minLength - Minimum run length to keep
 * @returns {Uint8Array} Filtered binary array
 */
function removeShortRuns(binary, minLength) {
  if (minLength <= 1) return binary;

  const result = new Uint8Array(binary);
  let runStart = null;

  for (let idx = 0; idx < binary.length; idx++) {
    const value = binary[idx];
    if (value === 1 && runStart === null) {
      runStart = idx;
    } else if (value === 0 && runStart !== null) {
      if (idx - runStart < minLength) {
        result.fill(0, runStart, idx);
      }
      runStart = null;
    }
  }

  // Handle trailing run
  if (runStart !== null && binary.length - runStart < minLength) {
    result.fill(0, runStart);
  }

  return result;
}

/**
 * Fill short silence runs (0s) between speech (1s).
 * Only fills gaps bounded by speech on BOTH sides.
 * @param {Uint8Array} binary - Binary speech decisions
 * @param {number} maxGap - Maximum gap length to fill
 * @returns {Uint8Array} Filled binary array
 */
function fillShortGaps(binary, maxGap) {
  if (maxGap <= 0) return binary;

  const result = new Uint8Array(binary);
  const n = result.length;
  let i = 0;

  while (i < n) {
    if (binary[i] !== 0) {
      i++;
      continue;
    }

    const start = i;
    while (i < n && binary[i] === 0) {
      i++;
    }
    const end = i;  // [start:end) is a 0-run

    // Only fill if this 0-run is between speech runs
    const leftHasSpeech = start > 0 && binary[start - 1] === 1;
    const rightHasSpeech = end < n && binary[end] === 1;
    
    if (leftHasSpeech && rightHasSpeech && (end - start) <= maxGap) {
      result.fill(1, start, end);
    }
  }

  return result;
}

/**
 * Apply padding around speech regions.
 * @param {Uint8Array} binary - Binary speech decisions
 * @param {number} pad - Padding amount in hops
 * @returns {Uint8Array} Padded binary array
 */
function applyPadding(binary, pad) {
  if (pad <= 0) return binary;

  const result = new Uint8Array(binary);
  
  for (let idx = 0; idx < binary.length; idx++) {
    if (binary[idx] === 1) {
      const start = Math.max(0, idx - pad);
      const end = Math.min(binary.length, idx + pad + 1);
      result.fill(1, start, end);
    }
  }

  return result;
}

/**
 * Merge speech regions separated by small gaps.
 * @param {Uint8Array} binary - Binary speech decisions
 * @param {number} mergeGap - Maximum gap to merge
 * @returns {Uint8Array} Merged binary array
 */
function mergeSmallGaps(binary, mergeGap) {
  if (mergeGap <= 0) return binary;

  const result = new Uint8Array(binary.length).fill(0);
  
  // Find speech indices
  const speechIndices = [];
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 1) speechIndices.push(i);
  }

  if (speechIndices.length === 0) return result;

  // Build runs
  const runs = [];
  let runStart = speechIndices[0];
  let prevIdx = speechIndices[0];

  for (let i = 1; i < speechIndices.length; i++) {
    const idx = speechIndices[i];
    if (idx - prevIdx > 1) {
      runs.push([runStart, prevIdx + 1]);
      runStart = idx;
    }
    prevIdx = idx;
  }
  runs.push([runStart, prevIdx + 1]);

  // Merge runs
  const merged = [];
  let [currentStart, currentEnd] = runs[0];

  for (let i = 1; i < runs.length; i++) {
    const [start, end] = runs[i];
    const gap = start - currentEnd;
    
    if (gap <= mergeGap) {
      currentEnd = end;
    } else {
      merged.push([currentStart, currentEnd]);
      currentStart = start;
      currentEnd = end;
    }
  }
  merged.push([currentStart, currentEnd]);

  // Fill result
  for (const [start, end] of merged) {
    result.fill(1, start, end);
  }

  return result;
}

/**
 * Smooth raw VAD probabilities into binary speech decisions.
 * 
 * @param {Float32Array|number[]} probabilities - Raw VAD probabilities (0-1) per hop
 * @param {number} hopSizeFrames - Hop size in audio frames
 * @param {number} sampleRate - Audio sample rate in Hz
 * @param {VADSmoothingParams} [params] - Smoothing configuration
 * @returns {Float32Array} Smoothed binary decisions (0.0 or 1.0)
 */
export function smoothVADProbabilities(probabilities, hopSizeFrames, sampleRate, params = {}) {
  const config = { ...DEFAULT_VAD_PARAMS, ...params };
  
  // Convert to array if needed
  const probs = probabilities instanceof Float32Array 
    ? probabilities 
    : new Float32Array(probabilities);

  if (probs.length === 0) {
    return new Float32Array(0);
  }

  const hopDurationMs = (hopSizeFrames / sampleRate) * 1000;

  // Convert thresholds to hop counts
  const minSpeechHops = config.minSpeechMs > 0 
    ? Math.max(1, Math.ceil(config.minSpeechMs / hopDurationMs)) 
    : 0;
  const minSilenceHops = config.minSilenceMs > 0 
    ? Math.ceil(config.minSilenceMs / hopDurationMs) 
    : 0;
  const padHops = config.padMs > 0 
    ? Math.ceil(config.padMs / hopDurationMs) 
    : 0;
  const mergeGapHops = config.mergeGapMs > 0 
    ? Math.ceil(config.mergeGapMs / hopDurationMs) 
    : 0;

  // Step 1: Initial binarization
  let binary = new Uint8Array(probs.length);
  for (let i = 0; i < probs.length; i++) {
    binary[i] = probs[i] >= config.threshold ? 1 : 0;
  }

  // Step 2: Fill short gaps to bridge near-speech regions
  binary = fillShortGaps(binary, minSilenceHops);

  // Step 3: Remove very short speech bursts (after bridging)
  binary = removeShortRuns(binary, minSpeechHops);

  // Step 4: Apply padding around speech regions
  binary = applyPadding(binary, padHops);

  // Step 5: Merge regions separated by small gaps
  if (mergeGapHops > 0) {
    binary = mergeSmallGaps(binary, mergeGapHops);
  }

  // Convert to Float32Array
  const result = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    result[i] = binary[i];
  }

  return result;
}

/**
 * Get speech boundaries from smoothed VAD decisions.
 * 
 * @param {Float32Array} smoothedVAD - Smoothed binary decisions
 * @param {number} hopSizeFrames - Hop size in audio frames
 * @param {number} sampleRate - Audio sample rate in Hz
 * @returns {Array<{startTime: number, endTime: number, startSample: number, endSample: number}>}
 */
export function getSpeechBoundaries(smoothedVAD, hopSizeFrames, sampleRate) {
  const boundaries = [];
  let inSpeech = false;
  let startIdx = 0;

  for (let i = 0; i < smoothedVAD.length; i++) {
    if (!inSpeech && smoothedVAD[i] > 0) {
      inSpeech = true;
      startIdx = i;
    } else if (inSpeech && smoothedVAD[i] === 0) {
      inSpeech = false;
      boundaries.push({
        startTime: (startIdx * hopSizeFrames) / sampleRate,
        endTime: (i * hopSizeFrames) / sampleRate,
        startSample: startIdx * hopSizeFrames,
        endSample: i * hopSizeFrames
      });
    }
  }

  // Handle case where speech continues to end
  if (inSpeech) {
    boundaries.push({
      startTime: (startIdx * hopSizeFrames) / sampleRate,
      endTime: (smoothedVAD.length * hopSizeFrames) / sampleRate,
      startSample: startIdx * hopSizeFrames,
      endSample: smoothedVAD.length * hopSizeFrames
    });
  }

  return boundaries;
}

/**
 * Calculate speech ratio from smoothed VAD.
 * 
 * @param {Float32Array} smoothedVAD - Smoothed binary decisions
 * @returns {number} Ratio of speech frames (0-1)
 */
export function getSpeechRatio(smoothedVAD) {
  if (smoothedVAD.length === 0) return 0;
  
  let speechFrames = 0;
  for (let i = 0; i < smoothedVAD.length; i++) {
    if (smoothedVAD[i] > 0) speechFrames++;
  }
  
  return speechFrames / smoothedVAD.length;
}

/**
 * Check if audio segment contains sufficient speech.
 * 
 * @param {Float32Array} smoothedVAD - Smoothed binary decisions
 * @param {number} [minRatio=0.1] - Minimum speech ratio required
 * @returns {boolean}
 */
export function hasSufficientSpeech(smoothedVAD, minRatio = 0.1) {
  return getSpeechRatio(smoothedVAD) >= minRatio;
}

export default {
  smoothVADProbabilities,
  getSpeechBoundaries,
  getSpeechRatio,
  hasSufficientSpeech,
  DEFAULT_VAD_PARAMS
};
