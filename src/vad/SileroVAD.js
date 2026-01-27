/**
 * Silero VAD implementation for browser using ONNX Runtime Web.
 * Based on onnx-asr/models/silero.py
 * 
 * Silero VAD is a high-quality Voice Activity Detector that runs efficiently
 * in the browser using the WASM backend.
 * 
 * NOTE: This module does NOT import onnxruntime-web directly to avoid version
 * conflicts with parakeet.js. Instead, it receives the ort instance from the
 * caller or uses the globally available ort set up by parakeet.js.
 */

// We do NOT import onnxruntime-web here to avoid conflicts with parakeet.js
// which uses a specific version. The init() method will receive ort as parameter
// or use globalThis.ort set up by parakeet.js

/**
 * @typedef {Object} SileroVADOptions
 * @property {number} [threshold=0.5] - Speech probability threshold
 * @property {number} [negThreshold=0.35] - Negative threshold for speech end detection
 * @property {number} [sampleRate=16000] - Audio sample rate (8000 or 16000)
 */

export class SileroVAD {
  /**
   * Create a new Silero VAD instance.
   * @param {SileroVADOptions} options 
   */
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.5;
    this.negThreshold = options.negThreshold ?? (this.threshold - 0.15);
    this.sampleRate = options.sampleRate ?? 16000;
    
    // Hop size and context size depend on sample rate
    this.hopSize = this.sampleRate === 16000 ? 512 : 256;  // 32ms at 16kHz
    this.contextSize = this.sampleRate === 16000 ? 64 : 32;
    
    this.session = null;
    this.state = null;  // LSTM hidden state [2, 1, 128]
    this.ort = null;
    this._initialized = false;
  }

  /**
   * Initialize the VAD model.
   * @param {string} modelPath - Path to the Silero VAD ONNX model
   * @param {Object} ortOverride - ONNX Runtime instance (required - get it from parakeet.js)
   */
  async init(modelPath, ortOverride = null) {
    // Get ONNX Runtime reference - must be passed in or available globally from parakeet.js
    // We don't import onnxruntime-web directly to avoid version conflicts
    this.ort = ortOverride || 
               (typeof globalThis !== 'undefined' && globalThis.ort) ||
               (typeof window !== 'undefined' && window.ort) ||
               (typeof self !== 'undefined' && self.ort);
    
    if (!this.ort) {
      throw new Error('ONNX Runtime not available. Please ensure parakeet.js is initialized first, or pass ort instance to init().');
    }
    
    console.log('[SileroVAD] Using ONNX Runtime from:', this.ort.env?.wasm?.wasmPaths || 'default paths');

    try {
      // Create session with WASM backend (lightweight, no GPU needed for VAD)
      this.session = await this.ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });

      // Initialize LSTM state: shape [2, 1, 128]
      this._resetState();
      this._initialized = true;
      
      console.log('[SileroVAD] Initialized with sample rate:', this.sampleRate);
    } catch (error) {
      console.error('[SileroVAD] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Reset the LSTM state (call when starting a new audio stream).
   */
  _resetState() {
    if (!this.ort) return;
    
    // State shape: [2, batch_size, 128] - 2 for h and c, batch_size=1
    const stateData = new Float32Array(2 * 1 * 128).fill(0);
    this.state = new this.ort.Tensor('float32', stateData, [2, 1, 128]);
  }

  /**
   * Reset VAD state for a new stream.
   */
  reset() {
    this._resetState();
  }

  /**
   * Process a single frame and return speech probability.
   * @param {Float32Array} frame - Audio frame of size hopSize + contextSize
   * @returns {Promise<number>} Speech probability (0-1)
   */
  async _processFrame(frame) {
    if (!this._initialized || !this.session) {
      throw new Error('VAD not initialized. Call init() first.');
    }

    // Input shape: [batch_size, frame_size] = [1, hopSize + contextSize]
    const inputTensor = new this.ort.Tensor('float32', frame, [1, frame.length]);
    
    // Sample rate tensor
    const srTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(this.sampleRate)]), [1]);

    const feeds = {
      input: inputTensor,
      state: this.state,
      sr: srTensor
    };

    const results = await this.session.run(feeds);
    
    // Update state for next frame
    this.state = results.stateN;
    
    // Output is [batch_size, 1], extract probability
    return results.output.data[0];
  }

  /**
   * Classify audio samples and return speech probabilities per hop.
   * @param {Float32Array} audio - Audio samples at the configured sample rate
   * @returns {Promise<Float32Array>} Speech probabilities, one per hop
   */
  async classify(audio) {
    if (!this._initialized) {
      throw new Error('VAD not initialized. Call init() first.');
    }

    if (audio.length < this.hopSize) {
      return new Float32Array(0);
    }

    const frameSize = this.hopSize + this.contextSize;
    const numFrames = Math.floor(audio.length / this.hopSize);
    const probabilities = new Float32Array(numFrames);

    for (let i = 0; i < numFrames; i++) {
      const startIdx = i * this.hopSize;
      let frame;

      if (i === 0) {
        // First frame: pad with zeros at the beginning
        frame = new Float32Array(frameSize);
        frame.fill(0, 0, this.contextSize);
        frame.set(audio.subarray(0, this.hopSize), this.contextSize);
      } else {
        // Subsequent frames: include context from previous samples
        const contextStart = startIdx - this.contextSize;
        if (contextStart >= 0) {
          frame = audio.subarray(contextStart, contextStart + frameSize);
        } else {
          // Partial context available
          frame = new Float32Array(frameSize);
          frame.fill(0, 0, -contextStart);
          frame.set(audio.subarray(0, frameSize + contextStart), -contextStart);
        }
      }

      // Ensure frame is exactly frameSize
      if (frame.length !== frameSize) {
        const paddedFrame = new Float32Array(frameSize);
        paddedFrame.set(frame.subarray(0, Math.min(frame.length, frameSize)));
        frame = paddedFrame;
      }

      probabilities[i] = await this._processFrame(frame);
    }

    return probabilities;
  }

  /**
   * Find speech segments in the probabilities using hysteresis.
   * @param {Float32Array} probabilities - Speech probabilities per hop
   * @returns {Array<{start: number, end: number}>} Speech segments in samples
   */
  findSegments(probabilities) {
    const segments = [];
    let inSpeech = false;
    let segmentStart = 0;

    for (let i = 0; i < probabilities.length; i++) {
      const prob = probabilities[i];
      
      if (!inSpeech && prob >= this.threshold) {
        // Speech start
        inSpeech = true;
        segmentStart = i * this.hopSize;
      } else if (inSpeech && prob < this.negThreshold) {
        // Speech end
        inSpeech = false;
        segments.push({
          start: segmentStart,
          end: i * this.hopSize
        });
      }
    }

    // Handle case where speech continues to the end
    if (inSpeech) {
      segments.push({
        start: segmentStart,
        end: probabilities.length * this.hopSize
      });
    }

    return segments;
  }

  /**
   * Check if audio contains speech above the threshold.
   * @param {Float32Array} audio - Audio samples
   * @param {number} [minRatio=0.1] - Minimum ratio of speech frames
   * @returns {Promise<boolean>} True if speech detected
   */
  async hasSpeech(audio, minRatio = 0.1) {
    const probs = await this.classify(audio);
    if (probs.length === 0) return false;
    
    const speechFrames = probs.filter(p => p >= this.threshold).length;
    return (speechFrames / probs.length) >= minRatio;
  }

  /**
   * Get speech ratio in the audio.
   * @param {Float32Array} audio - Audio samples
   * @returns {Promise<number>} Ratio of speech frames (0-1)
   */
  async getSpeechRatio(audio) {
    const probs = await this.classify(audio);
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
   * Dispose of the ONNX session.
   */
  async dispose() {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this._initialized = false;
  }
}

export default SileroVAD;
