/* eslint-disable no-restricted-globals */
import { RingBuffer } from '../utils/ringBuffer.js';
import TranscriptionMerger from '../TranscriptionMerger.js';
import FastMerger from '../FastMerger.js';
import { parakeetService } from '../ParakeetService.js';
import { SileroVAD } from '../vad/SileroVAD.js';
import { TenVAD } from '../vad/TenVAD.js';
import { smoothVADProbabilities, getSpeechRatio, DEFAULT_VAD_PARAMS } from '../vad/VADSmoothing.js';

// Utility function for timestamped logging
function logWithTimestamp(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [Worker] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [Worker] ${message}`);
  }
}

// Utility function to yield control back to the event loop
async function yieldControl() {
  return new Promise(resolve => {
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Utility function to process large arrays in chunks with yielding
async function processInChunks(array, chunkSize, processChunk) {
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    await processChunk(chunk, i);
    
    // Yield control periodically
    if (i % (chunkSize * 10) === 0) {
      await yieldControl();
    }
  }
}

// --- Audio buffering (fixed-size circular buffer) ---------------------------------
// Remove internal worker ring buffer; rely on VAD-gated segments stitched by AudioManager
let bufferStartAbs = 0;         // absolute timestamp for current stitched buffer start
let stitchedAudio = new Float32Array(0); // current stitched audio window

// --- Transcription merger ---------------------------------------------------------
let merger = new TranscriptionMerger();
let mergerMode = 'complex';  // 'complex' or 'fast'
let seqNum = 0; // monotonically-increasing sequence number for merger payloads

let matureCursorTime = 0;
let isTranscribing = false;
let sampleRate = 16000;
let sessionId = 'default';
let isModelReady = false;

// Resampling worker for offloading resampling work
let resamplingWorker = null;
let lastChunkStartAbs = 0;
let lastChunkEndAbs = 0;

// --- Streaming tuning params (configurable) ----------------------------------
let LEFT_CONTEXT_SECONDS = 0.8;        // adaptive; initial value
let LEFT_CONTEXT_MIN = 0.8;            // lower bound for adaptation
let LEFT_CONTEXT_MAX = 2.4;            // upper bound for adaptation
let TRIM_MARGIN_SECONDS = 0.05;        // drop words ending very near the cursor
let DROP_FIRST_BOUNDARY_WORD = true;   // heuristic: drop first in-window word
let WINDOW_SIZE_SECONDS = 30;          // hard clamp as safety (still applied)
let RIGHT_WINDOW_SECONDS = 1.6;        // size of newest chunk portion to decode (Rt)
let MIN_DECODE_SECONDS = 0.8;           // ensure decoder always gets at least this much audio
let INITIAL_BASE_SECONDS = 4.0;         // before first words finalize, allow more base audio

// Adaptive LC controls
let ADAPTIVE_LC_ENABLED = true;
let LC_INC_STEP = 0.2;
let LC_DEC_STEP = 0.2;
let LC_DECAY_STABLE_TICKS = 3; // number of stable updates before decay
let _stableTicks = 0;
let _lastStatsSnapshot = { wordsReplaced: 0, wordsAdded: 0, wordsKeptStable: 0 };

// Patch decode controls
let PATCH_ENABLED = true;
let PATCH_LEFT_SECONDS = 1.0;
let PATCH_RIGHT_SECONDS = 1.2;
let PATCH_COOLDOWN_MS = 750;
let _lastPatchTs = 0;
let _isPatching = false;

// --- VAD (Voice Activity Detection) controls ---------------------------------
let VAD_ENABLED = true;
let VAD_MODEL = 'silero';  // 'silero' or 'ten'
let VAD_THRESHOLD = 0.6;   // Higher = stricter speech detection (filters music better)
let VAD_MIN_SPEECH_MS = 240;
let VAD_MIN_SILENCE_MS = 480;
let VAD_PAD_MS = 20;
let VAD_MERGE_GAP_MS = 560;
let VAD_MIN_SPEECH_RATIO = 0.3;  // Require 30% of window to be speech before transcribing
let VAD_HOP_SIZE = 256;  // For TEN VAD: 160 (10ms) or 256 (16ms)
let VAD_MODEL_PATH = '/models/silero/model.onnx';      // Default path for Silero
let VAD_TEN_WASM_PATH = '/models/ten-vad/ten_vad.wasm'; // Default path for TEN VAD
let VAD_TEN_JS_PATH = '/models/ten-vad/ten_vad.js';     // Default path for TEN VAD JS loader

// VAD instance (can be SileroVAD or TenVAD)
let vad = null;
let vadReady = false;

self.onmessage = async (e) => {
  const { type, data } = e.data || {};

  switch (type) {
    case 'chunk': {
      let { audio, start, end, seqId, rate, segmentId } = data;

      if (!isModelReady) {
        logWithTimestamp('Model not ready, skipping chunk.');
        return;
      }

      // ---------------------------------------------------------------------------
      // VAD per-segment check: Skip non-speech segments early
      // ---------------------------------------------------------------------------
      sampleRate = rate || sampleRate;
      let segmentIsSpeech = true;
      let segmentSpeechRatio = 1.0;
      
      if (VAD_ENABLED && vadReady && vad && audio.length > 0) {
        try {
          // Resample to 16kHz if needed for VAD
          let audioForVAD = audio;
          if (sampleRate !== 16000) {
            const ratio = 16000 / sampleRate;
            const newLen = Math.round(audio.length * ratio);
            audioForVAD = new Float32Array(newLen);
            for (let i = 0; i < newLen; i++) {
              const t = i / ratio;
              const t0 = Math.floor(t);
              const t1 = Math.min(t0 + 1, audio.length - 1);
              const dt = t - t0;
              audioForVAD[i] = (1 - dt) * audio[t0] + dt * audio[t1];
            }
          }
          
          const vadProbs = await vad.classify(audioForVAD);
          if (vadProbs.length > 0) {
            const vadParams = {
              threshold: VAD_THRESHOLD,
              minSpeechMs: VAD_MIN_SPEECH_MS,
              minSilenceMs: VAD_MIN_SILENCE_MS,
              padMs: VAD_PAD_MS,
              mergeGapMs: VAD_MERGE_GAP_MS
            };
            const smoothedVAD = smoothVADProbabilities(vadProbs, vad.hopSize, 16000, vadParams);
            segmentSpeechRatio = getSpeechRatio(smoothedVAD);
            segmentIsSpeech = segmentSpeechRatio >= VAD_MIN_SPEECH_RATIO;
            
            // Send segment VAD status to UI for visualization/coloring
            // Always send - even for speech segments - so UI can update visualization
            self.postMessage({
              type: 'segment_vad_status',
              data: {
                segmentId: segmentId || seqId,
                startTime: start,
                endTime: end,
                isSpeech: segmentIsSpeech,
                speechRatio: segmentSpeechRatio,
                vadModel: VAD_MODEL,
                timestamp: Date.now()
              }
            });
            
            if (!segmentIsSpeech) {
              logWithTimestamp(`VAD: Segment skipped - not speech (ratio=${segmentSpeechRatio.toFixed(3)}, start=${start.toFixed(2)}s, id=${segmentId || seqId})`);
              // Don't add to buffer, don't trigger transcription
              return;
            }
            logWithTimestamp(`VAD: Segment is speech (ratio=${segmentSpeechRatio.toFixed(3)}, start=${start.toFixed(2)}s, id=${segmentId || seqId})`);
          }
        } catch (vadErr) {
          logWithTimestamp('VAD segment check failed, treating as speech:', vadErr.message);
        }
      }

      // ---------------------------------------------------------------------------
      // Maintain a stitched buffer from VAD-gated segments provided by AudioManager
      // ---------------------------------------------------------------------------
      if (stitchedAudio.length === 0) {
        bufferStartAbs = start;
        stitchedAudio = audio;
      } else {
        const expectedStartAbs = bufferStartAbs + (stitchedAudio.length / sampleRate);
        const tolerance = 1e-3;
        if (start > expectedStartAbs + tolerance) {
          // Gap: optionally insert tiny fixed silence (disabled by default)
          // For now, just append the new audio
          const newBuffer = new Float32Array(stitchedAudio.length + audio.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(audio, stitchedAudio.length);
          stitchedAudio = newBuffer;
        } else if (start < expectedStartAbs - tolerance) {
          // Overlap: trim overlapped prefix
          const overlapSec = expectedStartAbs - start;
          const skipFrames = Math.floor(overlapSec * sampleRate);
          const trimmed = skipFrames >= audio.length ? new Float32Array(0) : audio.subarray(skipFrames);
          const newBuffer = new Float32Array(stitchedAudio.length + trimmed.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(trimmed, stitchedAudio.length);
          stitchedAudio = newBuffer;
        } else {
          // Aligned: append
          const newBuffer = new Float32Array(stitchedAudio.length + audio.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(audio, stitchedAudio.length);
          stitchedAudio = newBuffer;
        }
      }
      lastChunkStartAbs = start;
      lastChunkEndAbs = end;

      // ---------------------------------------------------------------------------
      // 4.  Trigger transcription on the most-recent window
      // ---------------------------------------------------------------------------
      transcribeRecentWindow();
      break;
    }
    case 'cursor': {
      matureCursorTime = data.time || 0;
      break;
    }
    case 'config': {
      logWithTimestamp('Received config, loading model...');
      isModelReady = false;
      try {
        // Allow tuning params to be passed along with model config
        if (typeof data?.streaming === 'object') {
          const s = data.streaming;
          if (typeof s.leftContextSeconds === 'number') LEFT_CONTEXT_SECONDS = Math.min(Math.max(s.leftContextSeconds, LEFT_CONTEXT_MIN), LEFT_CONTEXT_MAX);
          if (typeof s.leftContextMin === 'number') LEFT_CONTEXT_MIN = s.leftContextMin;
          if (typeof s.leftContextMax === 'number') LEFT_CONTEXT_MAX = s.leftContextMax;
          if (typeof s.trimMarginSeconds === 'number') TRIM_MARGIN_SECONDS = Math.max(0, s.trimMarginSeconds);
          if (typeof s.dropFirstBoundaryWord === 'boolean') DROP_FIRST_BOUNDARY_WORD = s.dropFirstBoundaryWord;
          if (typeof s.windowSeconds === 'number') WINDOW_SIZE_SECONDS = Math.max(5, s.windowSeconds);
          if (typeof s.rightWindowSeconds === 'number') RIGHT_WINDOW_SECONDS = Math.max(0.2, s.rightWindowSeconds);
          if (typeof s.minDecodeSeconds === 'number') MIN_DECODE_SECONDS = Math.max(0.2, s.minDecodeSeconds);
          if (typeof s.initialBaseSeconds === 'number') INITIAL_BASE_SECONDS = Math.max(1.0, s.initialBaseSeconds);
          if (typeof s.adaptiveLcEnabled === 'boolean') ADAPTIVE_LC_ENABLED = s.adaptiveLcEnabled;
          if (typeof s.lcIncStep === 'number') LC_INC_STEP = Math.max(0.05, s.lcIncStep);
          if (typeof s.lcDecStep === 'number') LC_DEC_STEP = Math.max(0.05, s.lcDecStep);
          if (typeof s.lcDecayStableTicks === 'number') LC_DECAY_STABLE_TICKS = Math.max(1, Math.floor(s.lcDecayStableTicks));
          if (typeof s.patchEnabled === 'boolean') PATCH_ENABLED = s.patchEnabled;
          if (typeof s.patchLeftSeconds === 'number') PATCH_LEFT_SECONDS = Math.max(0.2, s.patchLeftSeconds);
          if (typeof s.patchRightSeconds === 'number') PATCH_RIGHT_SECONDS = Math.max(0.2, s.patchRightSeconds);
          if (typeof s.patchCooldownMs === 'number') PATCH_COOLDOWN_MS = Math.max(100, Math.floor(s.patchCooldownMs));
          logWithTimestamp('Updated streaming params', { LEFT_CONTEXT_SECONDS, LEFT_CONTEXT_MIN, LEFT_CONTEXT_MAX, TRIM_MARGIN_SECONDS, DROP_FIRST_BOUNDARY_WORD, WINDOW_SIZE_SECONDS, RIGHT_WINDOW_SECONDS, MIN_DECODE_SECONDS, INITIAL_BASE_SECONDS });
        }

        // VAD configuration - supports both nested (data.vad) and flat (data.vadEnabled, etc.) formats
        if (typeof data?.vad === 'object') {
          const v = data.vad;
          if (typeof v.enabled === 'boolean') VAD_ENABLED = v.enabled;
          if (typeof v.model === 'string' && (v.model === 'silero' || v.model === 'ten')) {
            VAD_MODEL = v.model;
          }
          if (typeof v.threshold === 'number') VAD_THRESHOLD = Math.max(0.1, Math.min(0.95, v.threshold));
          if (typeof v.minSpeechMs === 'number') VAD_MIN_SPEECH_MS = Math.max(50, v.minSpeechMs);
          if (typeof v.minSilenceMs === 'number') VAD_MIN_SILENCE_MS = Math.max(50, v.minSilenceMs);
          if (typeof v.padMs === 'number') VAD_PAD_MS = Math.max(0, v.padMs);
          if (typeof v.mergeGapMs === 'number') VAD_MERGE_GAP_MS = Math.max(0, v.mergeGapMs);
          if (typeof v.minSpeechRatio === 'number') VAD_MIN_SPEECH_RATIO = Math.max(0.01, Math.min(0.9, v.minSpeechRatio));
          if (typeof v.hopSize === 'number') VAD_HOP_SIZE = v.hopSize === 160 ? 160 : 256;
          if (typeof v.modelPath === 'string') VAD_MODEL_PATH = v.modelPath;
          if (typeof v.tenWasmPath === 'string') VAD_TEN_WASM_PATH = v.tenWasmPath;
          if (typeof v.tenJsPath === 'string') VAD_TEN_JS_PATH = v.tenJsPath;
        }
        // Also accept flat VAD properties from model store (vadEnabled, vadModel, etc.)
        if (typeof data?.vadEnabled === 'boolean') VAD_ENABLED = data.vadEnabled;
        if (typeof data?.vadModel === 'string' && (data.vadModel === 'silero' || data.vadModel === 'ten')) {
          VAD_MODEL = data.vadModel;
        }
        if (typeof data?.vadThreshold === 'number') VAD_THRESHOLD = Math.max(0.1, Math.min(0.95, data.vadThreshold));
        if (typeof data?.vadHopSize === 'number') VAD_HOP_SIZE = data.vadHopSize === 160 ? 160 : 256;
        if (typeof data?.vadModelPath === 'string') VAD_MODEL_PATH = data.vadModelPath;
        if (typeof data?.vadTenWasmPath === 'string') VAD_TEN_WASM_PATH = data.vadTenWasmPath;
        if (typeof data?.vadTenJsPath === 'string') VAD_TEN_JS_PATH = data.vadTenJsPath;
        
        logWithTimestamp('Updated VAD params', { VAD_ENABLED, VAD_MODEL, VAD_THRESHOLD, VAD_HOP_SIZE });

        // Merger mode configuration
        if (typeof data?.mergerMode === 'string') {
          const newMode = data.mergerMode === 'fast' ? 'fast' : 'complex';
          if (newMode !== mergerMode) {
            mergerMode = newMode;
            if (mergerMode === 'fast') {
              merger = new FastMerger({
                sentenceBoundaryProvider: 'nlp',  // Use winkNLP for proper sentence detection
                language: 'en',
                debug: false
              });
              logWithTimestamp('Switched to FastMerger (NLP sentence-based)');
            } else {
              merger = new TranscriptionMerger();
              logWithTimestamp('Switched to TranscriptionMerger (word-level alignment)');
            }
          }
        }

        // IMPORTANT: Load parakeet.js FIRST so that ONNX Runtime is properly configured
        // Silero VAD shares the same ONNX Runtime instance
        await parakeetService.reloadWithConfig(data);
        
        // Initialize VAD AFTER parakeet.js is loaded (so ONNX Runtime is available)
        // Try selected model first, fallback to Silero if TEN fails
        if (VAD_ENABLED && !vadReady) {
          let vadInitSuccess = false;
          
          // Try TEN VAD first if selected (doesn't need ONNX Runtime)
          if (VAD_MODEL === 'ten') {
            try {
              vad = new TenVAD({
                threshold: VAD_THRESHOLD,
                hopSize: VAD_HOP_SIZE,
                sampleRate: 16000
              });
              logWithTimestamp('TEN VAD: Loading model from', VAD_TEN_WASM_PATH);
              await vad.init(VAD_TEN_WASM_PATH, VAD_TEN_JS_PATH);
              vadReady = true;
              vadInitSuccess = true;
              logWithTimestamp('TEN VAD initialized successfully (277KB, low-latency)');
              self.postMessage({ type: 'vad_ready', data: { model: 'ten' } });
            } catch (tenVadErr) {
              logWithTimestamp('TEN VAD initialization failed, trying Silero fallback:', tenVadErr.message);
              self.postMessage({ type: 'vad_warning', data: { message: 'TEN VAD failed, falling back to Silero', error: tenVadErr.message } });
            }
          }
          
          // Try Silero VAD (uses ONNX Runtime from parakeet.js)
          if (!vadInitSuccess) {
            try {
              vad = new SileroVAD({
                threshold: VAD_THRESHOLD,
                sampleRate: 16000
              });
              logWithTimestamp('Silero VAD: Loading model from', VAD_MODEL_PATH);
              // Silero VAD will use globalThis.ort set up by parakeet.js
              await vad.init(VAD_MODEL_PATH);
              vadReady = true;
              vadInitSuccess = true;
              VAD_MODEL = 'silero';  // Update model type to reflect actual loaded model
              logWithTimestamp('Silero VAD initialized successfully');
              self.postMessage({ type: 'vad_ready', data: { model: 'silero' } });
            } catch (sileroVadErr) {
              logWithTimestamp('Silero VAD initialization also failed:', sileroVadErr.message);
            }
          }
          
          if (!vadInitSuccess) {
            logWithTimestamp('All VAD models failed to initialize, continuing without VAD');
            VAD_ENABLED = false;
            self.postMessage({ type: 'vad_error', data: { message: 'All VAD models failed to load', model: VAD_MODEL } });
          }
        }
        isModelReady = true;
        self.postMessage({ type: 'ready' });
        self.postMessage({ type: 'init_complete' });
        logWithTimestamp('Model is loaded and ready.');
      } catch (err) {
        logWithTimestamp('Model load failed:', err);
        self.postMessage({ type: 'error', data: { message: 'Model load failed: ' + err.message } });
      }
      break;
    }
    case 'init_vad': {
      // Initialize VAD model
      // Supports both Silero VAD (ONNX) and TEN VAD (WASM)
      if (data?.model) VAD_MODEL = data.model;
      if (data?.modelPath) VAD_MODEL_PATH = data.modelPath;
      if (data?.tenWasmPath) VAD_TEN_WASM_PATH = data.tenWasmPath;
      if (data?.tenJsPath) VAD_TEN_JS_PATH = data.tenJsPath;
      
      try {
        if (VAD_MODEL === 'ten') {
          // TEN VAD initialization
          if (!vad || !(vad instanceof TenVAD)) {
            vad = new TenVAD({
              threshold: VAD_THRESHOLD,
              hopSize: VAD_HOP_SIZE,
              sampleRate: 16000
            });
          }
          await vad.init(VAD_TEN_WASM_PATH, VAD_TEN_JS_PATH);
          vadReady = true;
          logWithTimestamp('TEN VAD model initialized successfully (277KB, low-latency)');
          self.postMessage({ type: 'vad_ready', data: { model: 'ten' } });
        } else {
          // Silero VAD initialization (default)
          if (!vad || !(vad instanceof SileroVAD)) {
            vad = new SileroVAD({
              threshold: VAD_THRESHOLD,
              sampleRate: 16000
            });
          }
          await vad.init(VAD_MODEL_PATH);
          vadReady = true;
          logWithTimestamp('Silero VAD model initialized successfully');
          self.postMessage({ type: 'vad_ready', data: { model: 'silero' } });
        }
      } catch (err) {
        logWithTimestamp('VAD model initialization failed:', err);
        VAD_ENABLED = false;
        self.postMessage({ type: 'vad_error', data: { message: err.message, model: VAD_MODEL } });
      }
      break;
    }
    case 'init_resampling_worker': {
      // Initialize the resampling worker
      if (!resamplingWorker) {
        try {
          const ResamplingWorkerModule = data.workerUrl;
          resamplingWorker = new Worker(ResamplingWorkerModule, { type: 'module' });
          resamplingWorker.onmessage = handleResamplingWorkerMessage;
          logWithTimestamp('Resampling worker initialized');
        } catch (err) {
          logWithTimestamp('Failed to initialize resampling worker:', err);
        }
      }
      break;
    }
  }
};

function handleResamplingWorkerMessage(e) {
  const { type, data } = e.data || {};
  
  switch (type) {
    case 'resample_complete': {
      // Handle resampled audio - this would be used in the transcription process
      logWithTimestamp(`Resampling complete: ${data.originalLength} -> ${data.resampledLength} samples`);
      break;
    }
    case 'error': {
      logWithTimestamp('Resampling worker error:', data.message);
      break;
    }
  }
}

async function transcribeRecentWindow() {
  if (isTranscribing || stitchedAudio.length === 0) return;

  const windowStartTime = performance.now();
  logWithTimestamp('Starting transcribeRecentWindow');

  // ---------------------------------------------------------------------------
  // 1.  Determine window [startFrame, endFrame)
  // ---------------------------------------------------------------------------
  const endFrame = Math.floor(stitchedAudio.length);
  if (endFrame === 0) return;

  // Define LC+Rt window strictly for decoding
  const streamEndAbs = bufferStartAbs + (stitchedAudio.length / sampleRate);
  const isBootstrap = !matureCursorTime || matureCursorTime <= 0;
  let desiredStartAbs, desiredEndAbs;

  if (isBootstrap) {
    // Bootstrap: decode a slightly larger base to seed first words
    desiredEndAbs = streamEndAbs;
    desiredStartAbs = Math.max(bufferStartAbs, desiredEndAbs - INITIAL_BASE_SECONDS);
  } else {
    desiredStartAbs = Math.max(bufferStartAbs, matureCursorTime - LEFT_CONTEXT_SECONDS);
    // Ensure we always include at least the latest segment end
    const rightByCursor = matureCursorTime + RIGHT_WINDOW_SECONDS;
    desiredEndAbs = Math.min(streamEndAbs, Math.max(lastChunkEndAbs, rightByCursor));
  }

  // Guarantee a minimum decode duration
  if (desiredEndAbs - desiredStartAbs < MIN_DECODE_SECONDS) {
    const needed = MIN_DECODE_SECONDS - (desiredEndAbs - desiredStartAbs);
    const canExtendEnd = streamEndAbs - desiredEndAbs;
    if (canExtendEnd >= needed) {
      desiredEndAbs = desiredEndAbs + needed;
    } else {
      desiredStartAbs = Math.max(bufferStartAbs, desiredStartAbs - (needed - canExtendEnd));
      desiredEndAbs = streamEndAbs;
    }
  }

  const fallbackStartAbs = Math.max(bufferStartAbs, streamEndAbs - WINDOW_SIZE_SECONDS);
  const windowStartAbs = Math.max(desiredStartAbs, fallbackStartAbs);
  let startFrame = Math.floor((windowStartAbs - bufferStartAbs) * sampleRate);
  if (startFrame < 0) startFrame = 0;
  if (startFrame >= endFrame) return;

  // End frame capped to LC+Rt
  const desiredEndAbsClamped = Math.max(bufferStartAbs, desiredEndAbs);
  let endFrameCapped = Math.floor((desiredEndAbsClamped - bufferStartAbs) * sampleRate);
  if (endFrameCapped <= startFrame || endFrameCapped > endFrame) endFrameCapped = endFrame;
  const audioToProcess = stitchedAudio.subarray(startFrame, endFrameCapped);
  if (audioToProcess.length === 0) return;

  logWithTimestamp(`Read audio data: ${audioToProcess.length} samples, window range: [${startFrame}, ${endFrame})`);

  // Add a small delay to prevent blocking the worker thread completely
  await new Promise(resolve => setTimeout(resolve, 0));

  isTranscribing = true;
  try {
    const t0 = performance.now();
    
    // Use resampling worker if available, otherwise fall back to direct resampling
    let audioForTranscription;
    if (sampleRate !== 16000) {
      if (resamplingWorker) {
        logWithTimestamp(`Sending ${audioToProcess.length} samples to resampling worker`);
        // Send to resampling worker
        const resamplingPromise = new Promise((resolve, reject) => {
          const handleResamplingResponse = (e) => {
            const { type, data } = e.data || {};
            if (type === 'resample_complete') {
              resamplingWorker.removeEventListener('message', handleResamplingResponse);
              resolve(data.audio);
            } else if (type === 'error') {
              resamplingWorker.removeEventListener('message', handleResamplingResponse);
              reject(new Error(data.message));
            }
          };
          
          resamplingWorker.addEventListener('message', handleResamplingResponse);
          resamplingWorker.postMessage({ 
            type: 'resample', 
            data: { 
              audio: audioToProcess,
              from: sampleRate,
              to: 16000
            } 
          }, [audioToProcess.buffer.slice(0)]); // Send a copy to avoid transfer issues
        });
        
        try {
          audioForTranscription = await resamplingPromise;
          logWithTimestamp(`Resampling worker completed: ${audioToProcess.length} -> ${audioForTranscription.length} samples`);
        } catch (resampleError) {
          logWithTimestamp('Resampling worker failed, falling back to direct resampling:', resampleError);
          audioForTranscription = await resampleDirect(audioToProcess, sampleRate, 16000);
        }
      } else {
        // Direct resampling in worker thread
        audioForTranscription = await resampleDirect(audioToProcess, sampleRate, 16000);
      }
    } else {
      audioForTranscription = audioToProcess;
      logWithTimestamp(`No resampling needed: ${audioToProcess.length} samples`);
    }
    
    // Add another small delay before transcription to allow other tasks to run
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // --- VAD Check: Skip transcription if audio is mostly silence/noise ---
    let vadSegments = null;  // Will hold speech segments for UI visualization
    let speechRatio = 1.0;   // Default to all speech if VAD not enabled
    
    if (VAD_ENABLED && vadReady && vad) {
      try {
        const vadProbs = await vad.classify(audioForTranscription);
        if (vadProbs.length > 0) {
          const vadParams = {
            threshold: VAD_THRESHOLD,
            minSpeechMs: VAD_MIN_SPEECH_MS,
            minSilenceMs: VAD_MIN_SILENCE_MS,
            padMs: VAD_PAD_MS,
            mergeGapMs: VAD_MERGE_GAP_MS
          };
          const smoothedVAD = smoothVADProbabilities(vadProbs, vad.hopSize, 16000, vadParams);
          speechRatio = getSpeechRatio(smoothedVAD);
          
          // Extract speech segments for visualization
          // Each segment: { startTime, endTime, isSpeech }
          vadSegments = [];
          let inSpeech = false;
          let segmentStart = 0;
          const hopDuration = vad.hopSize / 16000;
          
          for (let i = 0; i < smoothedVAD.length; i++) {
            const currentIsSpeech = smoothedVAD[i] >= VAD_THRESHOLD;
            const currentTime = windowStartAbs + (i * hopDuration);
            
            if (currentIsSpeech && !inSpeech) {
              // Speech starts
              segmentStart = currentTime;
              inSpeech = true;
            } else if (!currentIsSpeech && inSpeech) {
              // Speech ends
              vadSegments.push({
                startTime: segmentStart,
                endTime: currentTime,
                isSpeech: true
              });
              inSpeech = false;
            }
          }
          // Handle trailing speech segment
          if (inSpeech) {
            vadSegments.push({
              startTime: segmentStart,
              endTime: windowStartAbs + (smoothedVAD.length * hopDuration),
              isSpeech: true
            });
          }
          
          // Send VAD info to UI for visualization
          self.postMessage({
            type: 'vad_segments',
            data: {
              segments: vadSegments,
              speechRatio,
              windowStart: windowStartAbs,
              windowEnd: windowStartAbs + (audioForTranscription.length / 16000),
              timestamp: Date.now()
            }
          });
          
          if (speechRatio < VAD_MIN_SPEECH_RATIO) {
            logWithTimestamp(`VAD: Skipping transcription - insufficient speech (ratio=${speechRatio.toFixed(3)}, threshold=${VAD_MIN_SPEECH_RATIO})`);
            isTranscribing = false;
            return;
          }
          logWithTimestamp(`VAD: Speech detected (ratio=${speechRatio.toFixed(3)}, segments=${vadSegments.length})`);
        }
      } catch (vadErr) {
        logWithTimestamp('VAD check failed, proceeding with transcription:', vadErr);
      }
    }

    logWithTimestamp(`Starting transcription with ${audioForTranscription.length} samples`);
    // Provide incremental hint so decoder can reuse prefix state across calls
    const incOptions = {
      incremental: {
        cacheKey: sessionId + ':' + 'lc-rt',
        prefixSeconds: Math.max(0, Math.min(LEFT_CONTEXT_SECONDS, (bufferStartAbs + endFrame / sampleRate) - windowStartAbs))
      }
    };
    const result = await parakeetService.transcribe(audioForTranscription, 16000, incOptions);
    const elapsed = performance.now() - t0;
    logWithTimestamp(`Transcription completed in ${elapsed.toFixed(2)} ms`);

    const adjustedWords = result.words.map(w => ({
      ...w,
      start_time: w.start_time + windowStartAbs,
      end_time: w.end_time + windowStartAbs,
    }));

    // Trim words that are fully before the mature cursor (plus a small safety margin)
    let wordsForMerge = (matureCursorTime > 0)
      ? adjustedWords.filter(w => (w.end_time > (matureCursorTime + TRIM_MARGIN_SECONDS)))
      : adjustedWords;

    // Optionally drop the very first word inside the window as a boundary heuristic
    if (!isBootstrap && DROP_FIRST_BOUNDARY_WORD && wordsForMerge.length > 0) {
      const first = wordsForMerge[0];
      // Drop if it starts very close to the window start or just after the cursor
      const isBoundary = (first.start_time <= (matureCursorTime + TRIM_MARGIN_SECONDS)) ||
                         (first.start_time - windowStartAbs) <= 0.05;
      if (isBoundary) {
        wordsForMerge = wordsForMerge.slice(1);
      }
    }

    // --- Feed into merger --------------------------------------------------
    const payload = {
      session_id: sessionId,
      sequence_num: seqNum++,
      words: wordsForMerge,
      tokens: result.tokens || [],
      utterance_text: result.utterance_text ?? '',
      is_final: false,
      metrics: result.metrics ?? null,
    };

    logWithTimestamp(`Merging ${wordsForMerge.length} words (trimmed from ${adjustedWords.length}) using ${mergerMode} merger`);
    const merged = merger.merge(payload);
    logWithTimestamp(`Merge completed (${mergerMode}): ${merged.words.length} words, cursor=${merged.matureCursorTime?.toFixed(2)}s`);

    // Adaptive LC: analyze churn near the cursor and adjust LC up/down
    if (ADAPTIVE_LC_ENABLED && merged?.stats) {
      const deltaReplaced = Math.max(0, (merged.stats.wordsReplaced || 0) - (_lastStatsSnapshot.wordsReplaced || 0));
      const deltaAdded = Math.max(0, (merged.stats.wordsAdded || 0) - (_lastStatsSnapshot.wordsAdded || 0));
      const churn = deltaReplaced / Math.max(1, deltaAdded + 1);
      if (churn > 0.25) {
        // Unstable boundary -> increase LC
        LEFT_CONTEXT_SECONDS = Math.min(LEFT_CONTEXT_MAX, LEFT_CONTEXT_SECONDS + LC_INC_STEP);
        _stableTicks = 0;
        logWithTimestamp(`Adaptive LC: increased to ${LEFT_CONTEXT_SECONDS.toFixed(2)}s (churn=${churn.toFixed(2)})`);
      } else {
        _stableTicks += 1;
        if (_stableTicks >= LC_DECAY_STABLE_TICKS) {
          const old = LEFT_CONTEXT_SECONDS;
          LEFT_CONTEXT_SECONDS = Math.max(LEFT_CONTEXT_MIN, LEFT_CONTEXT_SECONDS - LC_DEC_STEP);
          if (LEFT_CONTEXT_SECONDS !== old) {
            logWithTimestamp(`Adaptive LC: decreased to ${LEFT_CONTEXT_SECONDS.toFixed(2)}s after stability`);
          }
          _stableTicks = 0;
        }
      }
      _lastStatsSnapshot = { ...merged.stats };
    }

    // --- Emit update -------------------------------------------------------
    self.postMessage({
      type: 'merged_transcription_update',
      data: {
        mergedWords: merged.words,
        stats: merged.stats,
        matureCursorTime: merged.matureCursorTime,
        lastSegmentId: payload.sequence_num,
        utterance_text: payload.utterance_text,
        is_final: payload.is_final,
        metrics: payload.metrics,
        timestamp: Date.now(),
        // Include VAD info so UI can visualize speech/silence
        vadInfo: vadSegments ? {
          speechRatio,
          segments: vadSegments,
          vadEnabled: VAD_ENABLED,
          vadModel: VAD_MODEL
        } : null,
        mergerMode  // Tell UI which merger is active
      }
    });

    // Also keep old simple message (optional, will be ignored by new UI)
    self.postMessage({
      type: 'result',
      data: {
        words: adjustedWords,
        perf: { totalMs: elapsed, audioSec: audioToProcess.length / sampleRate },
        sessionId,
      }
    });
    
    const windowElapsed = performance.now() - windowStartTime;
    logWithTimestamp(`transcribeRecentWindow completed in ${windowElapsed.toFixed(2)} ms`);
  } catch (err) {
    logWithTimestamp('Error in transcribeRecentWindow:', err);
    self.postMessage({ type: 'error', data: { message: err.message } });
  } finally {
    isTranscribing = false;

    // Optionally schedule a patch re-decode for the boundary band when instability was detected
    if (PATCH_ENABLED && !_isPatching) {
      const now = performance.now();
      if (now - _lastPatchTs > PATCH_COOLDOWN_MS) {
        const patchStart = Math.max(bufferStartAbs, matureCursorTime - PATCH_LEFT_SECONDS);
        const patchEnd = Math.min(bufferStartAbs + (stitchedAudio.length / sampleRate), matureCursorTime + PATCH_RIGHT_SECONDS);
        if (patchEnd > patchStart) {
          _isPatching = true;
          _lastPatchTs = now;
          try {
            // Ensure no other transcribe runs concurrently with patch
            if (isTranscribing) return; // safety
            isTranscribing = true;
            const ps = Math.floor((patchStart - bufferStartAbs) * sampleRate);
            const pe = Math.floor((patchEnd - bufferStartAbs) * sampleRate);
            const patchAudio = stitchedAudio.subarray(ps, pe);
            let patchAudio16k = patchAudio;
            if (sampleRate !== 16000) {
              patchAudio16k = await resampleDirect(patchAudio, sampleRate, 16000);
            }
            const patchResult = await parakeetService.transcribe(patchAudio16k, 16000, {
              frameStride: 1,
              incremental: { cacheKey: sessionId + ':patch', prefixSeconds: Math.min(LEFT_CONTEXT_SECONDS, PATCH_LEFT_SECONDS) },
              returnTimestamps: true,
              returnConfidences: true,
            });
            const adj = patchResult.words.map(w => ({
              ...w,
              start_time: w.start_time + patchStart,
              end_time: w.end_time + patchStart,
            }));
            const payload = {
              session_id: sessionId,
              sequence_num: seqNum++,
              words: adj,
              utterance_text: patchResult.utterance_text ?? '',
              is_final: false,
              metrics: patchResult.metrics ?? null,
            };
            const mergedPatch = merger.merge(payload);
            self.postMessage({
              type: 'merged_transcription_update',
              data: {
                mergedWords: mergedPatch.words,
                stats: mergedPatch.stats,
                matureCursorTime: mergedPatch.matureCursorTime,
                lastSegmentId: payload.sequence_num,
                utterance_text: payload.utterance_text,
                is_final: payload.is_final,
                metrics: payload.metrics,
                timestamp: Date.now(),
              }
            });
          } catch (e) {
            logWithTimestamp('Patch decode failed', e);
          } finally {
            isTranscribing = false;
            _isPatching = false;
          }
        }
      }
    }
  }
}

// Direct resampling function (fallback)
async function resampleDirect(audio, from, to) {
  if (from === to) {
    return audio;
  }

  const ratio = to / from;
  const newLength = Math.round(audio.length * ratio);
  const newAudio = new Float32Array(newLength);

  // Process in chunks to prevent blocking
  const CHUNK_SIZE = 10000;
  for (let i = 0; i < newLength; i += CHUNK_SIZE) {
    const endIndex = Math.min(i + CHUNK_SIZE, newLength);
    for (let j = i; j < endIndex; j++) {
      const t = j / ratio;
      const t0 = Math.floor(t);
      const t1 = Math.ceil(t);
      const dt = t - t0;

      if (t1 >= audio.length) {
        newAudio[j] = audio[t0];
      } else {
        newAudio[j] = (1 - dt) * audio[t0] + dt * audio[t1];
      }
    }
    
    // Yield control back to the event loop periodically
    if (i % (CHUNK_SIZE * 5) === 0) {
      await yieldControl();
    }
  }

  return newAudio;
}