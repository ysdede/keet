/**
 * TEN VAD (Voice Activity Detection) wrapper for browser using WASM.
 * 
 * Based on https://github.com/TEN-framework/ten-vad
 * 
 * TEN VAD is a low-latency, high-performance and lightweight VAD
 * that outperforms both WebRTC VAD and Silero VAD in precision.
 * 
 * Key features:
 * - 277KB library size (vs 2MB+ for Silero)
 * - Faster speech-to-non-speech transition detection
 * - Better detection of short silent durations between speech segments
 * - Operates on 16kHz audio with hop sizes of 160 (10ms) or 256 (16ms) samples
 */

import createVADModule from './ten_vad_module.js';

/**
 * @typedef {Object} TenVADOptions
 * @property {number} [hopSize=256] - Hop size in samples (160 or 256 for 16kHz)
 * @property {number} [threshold=0.5] - Speech probability threshold (0.0-1.0)
 * @property {number} [sampleRate=16000] - Audio sample rate (must be 16000)
 */

export class TenVAD {
  /**
   * Create a new TEN VAD instance.
   * @param {TenVADOptions} options 
   */
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.5;
    this.sampleRate = options.sampleRate ?? 16000;
    
    // TEN VAD supports hop sizes of 160 (10ms) or 256 (16ms) at 16kHz
    this.hopSize = options.hopSize ?? 256;
    if (this.hopSize !== 160 && this.hopSize !== 256) {
      console.warn('[TenVAD] hopSize should be 160 or 256, defaulting to 256');
      this.hopSize = 256;
    }
    
    this._module = null;
    this._vadHandle = 0;
    this._handlePtr = 0;
    this._probPtr = 0;
    this._flagPtr = 0;
    this._inputPtr = 0;
    this._inputSize = 0;
    this._initialized = false;
    this._version = null;
  }

  /**
   * Helper: Read null-terminated UTF8 string from WASM memory
   * @param {number} ptr - Pointer to string in WASM heap
   * @returns {string}
   */
  _utf8ToString(ptr) {
    if (!ptr) return '';
    const heap = this._module.HEAPU8;
    let end = ptr;
    while (heap[end]) end++;
    const bytes = heap.subarray(ptr, end);
    return new TextDecoder().decode(bytes);
  }

  /**
   * Initialize the TEN VAD module.
   * @param {string} wasmPath - Path to the ten_vad.wasm file
   * @param {string} [jsPath] - Not used (module is bundled)
   */
  async init(wasmPath, jsPath = null) {
    try {
      console.log('[TenVAD] Loading module from:', wasmPath);
      
      // Load the WASM module
      this._module = await createVADModule({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return wasmPath;
          }
          return path;
        }
      });

      console.log('[TenVAD] Module loaded, available functions:', 
        Object.keys(this._module).filter(k => k.startsWith('_')));

      // Allocate memory for handle pointer (4 bytes for int32)
      this._handlePtr = this._module._malloc(4);
      if (!this._handlePtr) {
        throw new Error('Failed to allocate memory for handle pointer');
      }
      
      // Initialize handle pointer to 0
      this._module.HEAP32[this._handlePtr >> 2] = 0;

      // Call ten_vad_create(handlePtr, hopSize, threshold)
      // Returns: 0 on success, -1 on error
      const result = this._module._ten_vad_create(this._handlePtr, this.hopSize, this.threshold);
      
      if (result !== 0) {
        this._module._free(this._handlePtr);
        throw new Error(`ten_vad_create failed with code: ${result}`);
      }

      // Read the handle value from the pointer
      this._vadHandle = this._module.HEAP32[this._handlePtr >> 2];
      
      if (!this._vadHandle) {
        this._module._free(this._handlePtr);
        throw new Error('VAD handle is null after creation');
      }

      // Allocate output pointers for process calls
      this._probPtr = this._module._malloc(4); // float
      this._flagPtr = this._module._malloc(4); // int32

      if (!this._probPtr || !this._flagPtr) {
        this.dispose();
        throw new Error('Failed to allocate output pointers');
      }

      // Pre-allocate input buffer for hopSize samples (int16)
      this._inputSize = this.hopSize * 2; // 2 bytes per int16
      this._inputPtr = this._module._malloc(this._inputSize);
      
      if (!this._inputPtr) {
        this.dispose();
        throw new Error('Failed to allocate input buffer');
      }

      // Get version if available
      if (this._module._ten_vad_get_version) {
        const versionPtr = this._module._ten_vad_get_version();
        this._version = this._utf8ToString(versionPtr);
      }

      this._initialized = true;
      console.log('[TenVAD] Initialized successfully');
      console.log('[TenVAD] hopSize:', this.hopSize, 'threshold:', this.threshold);
      if (this._version) {
        console.log('[TenVAD] Version:', this._version);
      }
    } catch (error) {
      console.error('[TenVAD] Failed to initialize:', error);
      this.dispose();
      throw error;
    }
  }

  /**
   * Reset the VAD state (call when starting a new audio stream).
   */
  reset() {
    // TEN VAD doesn't seem to have a reset function in the API
    // If needed, we can destroy and recreate
  }

  /**
   * Process a single frame and return speech probability.
   * @param {Int16Array|Float32Array} frame - Audio frame of hopSize samples
   * @returns {Object} Result with probability and flag
   */
  _processFrame(frame) {
    if (!this._initialized) {
      throw new Error('TEN VAD not initialized. Call init() first.');
    }

    // Convert Float32Array to Int16Array if needed (TEN VAD expects int16)
    let int16Frame;
    if (frame instanceof Float32Array) {
      int16Frame = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        // Clamp and convert to int16
        const s = Math.max(-1, Math.min(1, frame[i]));
        int16Frame[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
    } else {
      int16Frame = frame;
    }

    // Ensure frame size matches hopSize
    if (int16Frame.length !== this.hopSize) {
      console.warn(`[TenVAD] Frame size ${int16Frame.length} != hopSize ${this.hopSize}`);
    }

    // Copy data to pre-allocated WASM heap buffer
    this._module.HEAP16.set(int16Frame, this._inputPtr >> 1);

    // Initialize output values
    this._module.HEAPF32[this._probPtr >> 2] = 0;
    this._module.HEAP32[this._flagPtr >> 2] = 0;

    // Call ten_vad_process(handle, audioDataPtr, audioDataLength, outProbabilityPtr, outFlagPtr)
    const result = this._module._ten_vad_process(
      this._vadHandle,
      this._inputPtr,
      int16Frame.length,
      this._probPtr,
      this._flagPtr
    );

    if (result !== 0) {
      console.warn('[TenVAD] process returned error:', result);
    }

    // Read output values
    const probability = this._module.HEAPF32[this._probPtr >> 2];
    const flag = this._module.HEAP32[this._flagPtr >> 2];

    return { probability, flag, isVoice: flag === 1 };
  }

  /**
   * Classify audio samples and return speech probabilities per hop.
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @returns {Float32Array} Speech probabilities, one per hop
   */
  classify(audio) {
    if (!this._initialized) {
      throw new Error('TEN VAD not initialized. Call init() first.');
    }

    if (audio.length < this.hopSize) {
      return new Float32Array(0);
    }

    const numFrames = Math.floor(audio.length / this.hopSize);
    const probabilities = new Float32Array(numFrames);

    for (let i = 0; i < numFrames; i++) {
      const startIdx = i * this.hopSize;
      const frame = audio.subarray(startIdx, startIdx + this.hopSize);
      const result = this._processFrame(frame);
      probabilities[i] = result.probability;
    }

    return probabilities;
  }

  /**
   * Process audio and return speech segments using built-in detection.
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @returns {Array<{start: number, end: number, probability: number}>} Speech segments
   */
  findSegments(audio) {
    const probabilities = this.classify(audio);
    const segments = [];
    let inSpeech = false;
    let segmentStart = 0;

    for (let i = 0; i < probabilities.length; i++) {
      const prob = probabilities[i];
      
      if (!inSpeech && prob >= this.threshold) {
        // Speech start
        inSpeech = true;
        segmentStart = i * this.hopSize;
      } else if (inSpeech && prob < this.threshold) {
        // Speech end
        inSpeech = false;
        segments.push({
          start: segmentStart,
          end: i * this.hopSize,
          probability: probabilities.slice(
            Math.floor(segmentStart / this.hopSize), 
            i
          ).reduce((a, b) => a + b, 0) / (i - Math.floor(segmentStart / this.hopSize))
        });
      }
    }

    // Handle case where speech continues to the end
    if (inSpeech) {
      segments.push({
        start: segmentStart,
        end: probabilities.length * this.hopSize,
        probability: probabilities.slice(
          Math.floor(segmentStart / this.hopSize)
        ).reduce((a, b) => a + b, 0) / (probabilities.length - Math.floor(segmentStart / this.hopSize))
      });
    }

    return segments;
  }

  /**
   * Check if audio contains speech above the threshold.
   * @param {Float32Array} audio - Audio samples
   * @param {number} [minRatio=0.1] - Minimum ratio of speech frames
   * @returns {boolean} True if speech detected
   */
  hasSpeech(audio, minRatio = 0.1) {
    const probs = this.classify(audio);
    if (probs.length === 0) return false;
    
    const speechFrames = probs.filter(p => p >= this.threshold).length;
    return (speechFrames / probs.length) >= minRatio;
  }

  /**
   * Get speech ratio in the audio.
   * @param {Float32Array} audio - Audio samples
   * @returns {number} Ratio of speech frames (0-1)
   */
  getSpeechRatio(audio) {
    const probs = this.classify(audio);
    if (probs.length === 0) return 0;
    
    const speechFrames = probs.filter(p => p >= this.threshold).length;
    return speechFrames / probs.length;
  }

  /**
   * Convert hop index to time in seconds.
   * @param {number} hopIndex 
   * @returns {number} Time in seconds
   */
  hopToTime(hopIndex) {
    return (hopIndex * this.hopSize) / this.sampleRate;
  }

  /**
   * Convert time in seconds to hop index.
   * @param {number} timeSeconds 
   * @returns {number} Hop index
   */
  timeToHop(timeSeconds) {
    return Math.floor((timeSeconds * this.sampleRate) / this.hopSize);
  }

  /**
   * Check if the VAD is initialized and ready.
   * @returns {boolean}
   */
  get isReady() {
    return this._initialized;
  }

  /**
   * Get hop duration in milliseconds.
   * @returns {number}
   */
  get hopDurationMs() {
    return (this.hopSize / this.sampleRate) * 1000;
  }

  /**
   * Get the VAD version string.
   * @returns {string|null}
   */
  get version() {
    return this._version;
  }

  /**
   * Dispose of the VAD instance and free memory.
   */
  dispose() {
    if (this._module) {
      // Destroy VAD instance
      if (this._vadHandle && this._module._ten_vad_destroy) {
        this._module._ten_vad_destroy(this._handlePtr);
      }
      
      // Free allocated memory
      if (this._handlePtr) this._module._free(this._handlePtr);
      if (this._probPtr) this._module._free(this._probPtr);
      if (this._flagPtr) this._module._free(this._flagPtr);
      if (this._inputPtr) this._module._free(this._inputPtr);
    }
    
    this._vadHandle = 0;
    this._handlePtr = 0;
    this._probPtr = 0;
    this._flagPtr = 0;
    this._inputPtr = 0;
    this._module = null;
    this._initialized = false;
  }
}

export default TenVAD;
