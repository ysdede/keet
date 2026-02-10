import { createSignal, createRoot } from 'solid-js';
import { appStore } from '../../stores/appStore';
import { AudioEngine } from '../audio';
import { MelWorkerClient } from '../audio/MelWorkerClient';
import { TranscriptionWorkerClient } from '../transcription';
import { HybridVAD } from '../vad';
import { WindowBuilder } from '../transcription/WindowBuilder';
import { BufferWorkerClient } from '../buffer';
import { TenVADWorkerClient } from '../vad/TenVADWorkerClient';
import type { V4ProcessResult } from '../transcription/TranscriptionWorkerClient';
import type { BufferWorkerConfig, TenVADResult } from '../buffer/types';

function createRecordingManager() {
  // Signals for UI binding
  const [audioEngine, setAudioEngine] = createSignal<AudioEngine | null>(null);
  const [melClient, setMelClient] = createSignal<MelWorkerClient | null>(null);

  // Internal state (not reactive)
  let workerClient: TranscriptionWorkerClient | null = null;
  let segmentUnsubscribe: (() => void) | null = null;
  let windowUnsubscribe: (() => void) | null = null;
  let melChunkUnsubscribe: (() => void) | null = null;
  let energyPollInterval: number | undefined;

  // v4 pipeline instances
  let hybridVAD: HybridVAD | null = null;
  let bufferClient: BufferWorkerClient | null = null;
  let tenVADClient: TenVADWorkerClient | null = null;
  let windowBuilder: WindowBuilder | null = null;
  let v4TickTimeout: number | undefined;
  let v4TickRunning = false;
  let v4AudioChunkUnsubscribe: (() => void) | null = null;
  let v4MelChunkUnsubscribe: (() => void) | null = null;
  let v4InferenceBusy = false;
  let v4LastInferenceTime = 0;

  // Global sample counter for audio chunks (tracks total samples written to BufferWorker)
  let v4GlobalSampleOffset = 0;

  // Throttle UI updates from TEN-VAD to at most once per frame
  let pendingSileroProb: number | null = null;
  let sileroUpdateScheduled = false;
  let pendingVadState: {
    isSpeech: boolean;
    energy: number;
    snr: number;
    hybridState: string;
    sileroProbability?: number;
  } | null = null;
  let vadUpdateScheduled = false;

  let v4TickCount = 0;
  let v4ModelNotReadyLogged = false;

  const initialize = () => {
    workerClient = new TranscriptionWorkerClient();

    workerClient.onModelProgress = (p) => {
      appStore.setModelProgress(p.progress);
      appStore.setModelMessage(p.message || '');
      if (p.file) appStore.setModelFile(p.file);
    };

    workerClient.onModelStateChange = (s) => {
      appStore.setModelState(s);
    };

    workerClient.onV3Confirmed = (text) => {
      appStore.setTranscript(text);
    };

    workerClient.onV3Pending = (text) => {
      appStore.setPendingText(text);
    };

    workerClient.onError = (msg) => {
      appStore.setErrorMessage(msg);
    };

    appStore.refreshDevices();
  };

  const scheduleSileroUpdate = (prob: number) => {
    pendingSileroProb = prob;
    if (sileroUpdateScheduled) return;
    sileroUpdateScheduled = true;
    requestAnimationFrame(() => {
      sileroUpdateScheduled = false;
      if (pendingSileroProb === null) return;
      const currentState = appStore.vadState();
      appStore.setVadState({
        ...currentState,
        sileroProbability: pendingSileroProb,
      });
    });
  };

  const scheduleVadStateUpdate = (next: {
    isSpeech: boolean;
    energy: number;
    snr: number;
    hybridState: string;
    sileroProbability?: number;
  }) => {
    pendingVadState = next;
    if (vadUpdateScheduled) return;
    vadUpdateScheduled = true;
    requestAnimationFrame(() => {
      vadUpdateScheduled = false;
      if (!pendingVadState) return;
      const currentState = appStore.vadState();
      const sileroProbability =
        pendingVadState.sileroProbability !== undefined
          ? pendingVadState.sileroProbability
          : currentState.sileroProbability;
      appStore.setVadState({
        ...currentState,
        ...pendingVadState,
        sileroProbability,
      });
      appStore.setIsSpeechDetected(pendingVadState.isSpeech);
      pendingVadState = null;
    });
  };

  // ---- v4 pipeline tick: periodic window building + inference ----
  const v4Tick = async () => {
    // Access current signal value
    const engine = audioEngine();
    if (!workerClient || !windowBuilder || !engine || !bufferClient || v4InferenceBusy) return;

    // Skip inference if model is not ready (but still allow audio/mel/VAD to process)
    if (appStore.modelState() !== 'ready') {
      if (!v4ModelNotReadyLogged) {
        console.log('[v4Tick] Model not ready yet - audio is being captured and preprocessed');
        v4ModelNotReadyLogged = true;
      }
      return;
    }
    // Reset the flag once model becomes ready
    if (v4ModelNotReadyLogged) {
      console.log('[v4Tick] Model is now ready - starting inference');
      v4ModelNotReadyLogged = false;
      // Initialize the v4 service now that model is ready
      await workerClient.initV4Service({ debug: false });
    }

    v4TickCount++;
    const now = performance.now();
    // Use the store's configurable inference interval (minus a small margin for the tick jitter)
    const minInterval = Math.max(200, appStore.v4InferenceIntervalMs() - 100);
    if (now - v4LastInferenceTime < minInterval) return;

    // Check if there is speech via the BufferWorker (async query).
    // We check both energy and inference VAD layers; either one detecting speech triggers inference.
    const cursorSample = windowBuilder.getMatureCursorFrame(); // frame === sample in our pipeline
    const currentSample = v4GlobalSampleOffset;
    const startSample = cursorSample > 0 ? cursorSample : 0;

    let hasSpeech = false;
    if (currentSample > startSample) {
      // Check energy VAD first (always available, low latency)
      const energyResult = await bufferClient.hasSpeech('energyVad', startSample, currentSample, 0.3);

      // When inference VAD is ready, require BOTH energy AND inference to agree
      // This prevents false positives from music/noise that has high energy but no speech
      if (tenVADClient?.isReady()) {
        const inferenceResult = await bufferClient.hasSpeech('inferenceVad', startSample, currentSample, 0.5);
        // Require both energy and inference VAD to agree (AND logic)
        hasSpeech = energyResult.hasSpeech && inferenceResult.hasSpeech;
      } else {
        // Fall back to energy-only if inference VAD is not available
        hasSpeech = energyResult.hasSpeech;
      }
    }

    if (v4TickCount <= 5 || v4TickCount % 20 === 0) {
      const vadState = appStore.vadState();
      const rb = engine.getRingBuffer();
      const rbFrame = rb.getCurrentFrame();
      const rbBase = rb.getBaseFrameOffset();
      console.log(
        `[v4Tick #${v4TickCount}] hasSpeech=${hasSpeech}, vadState=${vadState.hybridState}, ` +
        `energy=${vadState.energy.toFixed(4)}, inferenceVAD=${(vadState.sileroProbability || 0).toFixed(2)}, ` +
        `samples=[${startSample}:${currentSample}], ` +
        `ringBuf=[base=${rbBase}, head=${rbFrame}, avail=${rbFrame - rbBase}]`
      );
    }

    // Periodic buffer worker state dump (every 40 ticks)
    if (v4TickCount % 40 === 0 && bufferClient) {
      try {
        const state = await bufferClient.getState();
        const layerSummary = Object.entries(state.layers)
          .map(([id, l]) => `${id}:${l.fillCount}/${l.maxEntries}@${l.currentSample}`)
          .join(', ');
        console.log(`[v4Tick #${v4TickCount}] BufferState: ${layerSummary}`);
      } catch (_) { /* ignore state query errors */ }
    }

    if (!hasSpeech) {
      // Check for silence-based flush using BufferWorker
      const silenceDuration = await bufferClient.getSilenceTailDuration('energyVad', 0.3);
      if (silenceDuration >= appStore.v4SilenceFlushSec()) {
        // Flush pending sentence via timeout finalization
        try {
          const flushResult = await workerClient.v4FinalizeTimeout();
          if (flushResult) {
            appStore.setMatureText(flushResult.matureText);
            appStore.setImmatureText(flushResult.immatureText);
            appStore.setMatureCursorTime(flushResult.matureCursorTime);
            appStore.setTranscript(flushResult.fullText);
            // Advance window builder cursor
            windowBuilder.advanceMatureCursorByTime(flushResult.matureCursorTime);
          }
        } catch (err) {
          console.error('[v4Tick] Flush error:', err);
        }
      }
      return;
    }

    // Build window from cursor to current position
    const window = windowBuilder.buildWindow();
    if (!window) {
      if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
        const rb = engine.getRingBuffer();
        const rbHead = rb.getCurrentFrame();
        const rbBase = rb.getBaseFrameOffset();
        console.log(
          `[v4Tick #${v4TickCount}] buildWindow=null, ` +
          `ringBuf=[base=${rbBase}, head=${rbHead}, avail=${rbHead - rbBase}], ` +
          `cursor=${windowBuilder.getMatureCursorFrame()}`
        );
      }
      return;
    }

    console.log(`[v4Tick #${v4TickCount}] Window [${window.startFrame}:${window.endFrame}] ${window.durationSeconds.toFixed(2)}s (initial=${window.isInitial})`);

    v4InferenceBusy = true;
    v4LastInferenceTime = now;

    try {
      const inferenceStart = performance.now();

      // Get mel features for the window
      let features: { features: Float32Array; T: number; melBins: number } | null = null;
      const mel = melClient();
      if (mel) {
        features = await mel.getFeatures(window.startFrame, window.endFrame);
      }

      if (!features) {
        v4InferenceBusy = false;
        return;
      }

      // Calculate time offset for absolute timestamps
      const timeOffset = window.startFrame / 16000;

      // Calculate incremental cache parameters
      const cursorFrame = windowBuilder.getMatureCursorFrame();
      const prefixSeconds = cursorFrame > 0 ? (window.startFrame - cursorFrame) / 16000 : 0;

      const result: V4ProcessResult = await workerClient.processV4ChunkWithFeatures({
        features: features.features,
        T: features.T,
        melBins: features.melBins,
        timeOffset,
        endTime: window.endFrame / 16000,
        segmentId: `v4_${Date.now()}`,
        incrementalCache: prefixSeconds > 0 ? {
          cacheKey: 'v4-stream',
          prefixSeconds,
        } : undefined,
      });

      const inferenceMs = performance.now() - inferenceStart;

      // Update UI state
      appStore.setMatureText(result.matureText);
      appStore.setImmatureText(result.immatureText);
      appStore.setTranscript(result.fullText);
      appStore.setPendingText(result.immatureText);
      appStore.setInferenceLatency(inferenceMs);

      // Update RTF
      const audioDurationMs = window.durationSeconds * 1000;
      appStore.setRtf(inferenceMs / audioDurationMs);

      // Advance cursor if merger advanced it
      if (result.matureCursorTime > windowBuilder.getMatureCursorTime()) {
        appStore.setMatureCursorTime(result.matureCursorTime);
        windowBuilder.advanceMatureCursorByTime(result.matureCursorTime);
        windowBuilder.markSentenceEnd(Math.round(result.matureCursorTime * 16000));
      }

      // Update stats
      appStore.setV4MergerStats({
        sentencesFinalized: result.matureSentenceCount,
        cursorUpdates: result.stats?.matureCursorUpdates || 0,
        utterancesProcessed: result.stats?.utterancesProcessed || 0,
      });

      // Update buffer metrics
      const ring = engine.getRingBuffer();
      appStore.setBufferMetrics({
        fillRatio: ring.getFillCount() / ring.getSize(),
        latencyMs: (ring.getFillCount() / 16000) * 1000,
      });

      // Update metrics
      if (result.metrics) {
        appStore.setSystemMetrics({
          throughput: 0,
          modelConfidence: 0,
        });
      }
    } catch (err: any) {
      console.error('[v4Tick] Inference error:', err);
    } finally {
      v4InferenceBusy = false;
    }
  };

  const cleanupV4Pipeline = () => {
    v4TickRunning = false;
    if (v4TickTimeout) {
      clearTimeout(v4TickTimeout);
      v4TickTimeout = undefined;
    }
    if (v4AudioChunkUnsubscribe) {
      v4AudioChunkUnsubscribe();
      v4AudioChunkUnsubscribe = null;
    }
    if (v4MelChunkUnsubscribe) {
      v4MelChunkUnsubscribe();
      v4MelChunkUnsubscribe = null;
    }
    hybridVAD = null;
    if (tenVADClient) {
      tenVADClient.dispose();
      tenVADClient = null;
    }
    if (bufferClient) {
      bufferClient.dispose();
      bufferClient = null;
    }
    windowBuilder = null;
    v4InferenceBusy = false;
    v4LastInferenceTime = 0;
    v4GlobalSampleOffset = 0;
  };

  const dispose = () => {
    if (energyPollInterval) clearInterval(energyPollInterval);
    cleanupV4Pipeline();
    melClient()?.dispose();
    workerClient?.dispose();
  };

  const toggleRecording = async () => {
    const isRecording = () => appStore.recordingState() === 'recording';
    const isModelReady = () => appStore.modelState() === 'ready';

    if (isRecording()) {
      if (energyPollInterval) {
        clearInterval(energyPollInterval);
        energyPollInterval = undefined;
      }
      audioEngine()?.stop();

      if (segmentUnsubscribe) segmentUnsubscribe();
      if (windowUnsubscribe) windowUnsubscribe();
      if (melChunkUnsubscribe) melChunkUnsubscribe();
      cleanupV4Pipeline();

      if (workerClient) {
        const final = await workerClient.finalize();
        const text = (final as any).text || (final as any).fullText || '';
        appStore.setTranscript(text);
        appStore.setPendingText('');
      }

      melClient()?.reset();
      // Don't nullify melClient here, just reset it, but if needed we can set null
      // Actually we keep the instance if possible, but let's see.
      // The current logic doesn't clear melClient variable here, only calls .reset()
      // So signal should remain valid.
      audioEngine()?.reset();
      appStore.setAudioLevel(0);
      appStore.stopRecording();
    } else {
      try {
        let engine = audioEngine();
        if (!engine) {
          engine = new AudioEngine({
            sampleRate: 16000,
            deviceId: appStore.selectedDeviceId(),
          });
          setAudioEngine(engine);
        } else {
          engine.updateConfig({ deviceId: appStore.selectedDeviceId() });
          engine.reset();
        }

        const mode = appStore.transcriptionMode();

        // v4 mode: Always start audio capture, mel preprocessing, and VAD
        // Inference only runs when model is ready (checked in v4Tick)
        if (mode === 'v4-utterance') {
          // ---- v4: Utterance-based pipeline with BufferWorker + TEN-VAD ----

          // Initialize merger in worker only if model is ready
          if (isModelReady() && workerClient) {
            await workerClient.initV4Service({ debug: false });
          }

          // Initialize mel worker (always needed for preprocessing)
          let mel = melClient();
          if (!mel) {
            mel = new MelWorkerClient();
            setMelClient(mel);
          }
          try {
            await mel.init({ nMels: 128 });
          } catch (e) {
            mel.dispose();
            setMelClient(null);
          }

          // Initialize BufferWorker (centralized multi-layer data store)
          bufferClient = new BufferWorkerClient();
          const bufferConfig: BufferWorkerConfig = {
            sampleRate: 16000,
            layers: {
              audio: { hopSamples: 1, entryDimension: 1, maxDurationSec: 120 },
              mel: { hopSamples: 160, entryDimension: 128, maxDurationSec: 120 },
              energyVad: { hopSamples: 1280, entryDimension: 1, maxDurationSec: 120 },
              inferenceVad: { hopSamples: 256, entryDimension: 1, maxDurationSec: 120 },
            },
          };
          await bufferClient.init(bufferConfig);

          // Initialize TEN-VAD worker (inference-based VAD)
          tenVADClient = new TenVADWorkerClient();
          tenVADClient.onResult((result: TenVADResult) => {
            if (!bufferClient) return;
            // Batch-write hop probabilities to inferenceVad (single worker message)
            if (result.hopCount > 0) {
              const lastProb = result.probabilities[result.hopCount - 1];
              if (bufferClient.writeBatchTransfer) {
                bufferClient.writeBatchTransfer('inferenceVad', result.probabilities, result.globalSampleOffset);
              } else {
                bufferClient.writeBatch('inferenceVad', result.probabilities, result.globalSampleOffset);
              }

              // Update UI at most once per frame with the latest probability
              scheduleSileroUpdate(lastProb);
            }
          });
          // TEN-VAD init is non-blocking; falls back gracefully if WASM fails
          tenVADClient.init({ hopSize: 256, threshold: 0.5 }).catch((err) => {
            console.warn('[v4] TEN-VAD init failed, using energy-only:', err);
          });

          // Initialize hybrid VAD for energy-based detection (always runs, fast)
          hybridVAD = new HybridVAD({
            sileroThreshold: 0.5,
            onsetConfirmations: 2,
            offsetConfirmations: 3,
            sampleRate: 16000,
          });
          // Do NOT init Silero in HybridVAD (TEN-VAD replaces it)

          // NOTE: WindowBuilder is created AFTER audioEngine.start() below,
          // because start() may re-create the internal RingBuffer.

          // Reset global sample counter
          v4GlobalSampleOffset = 0;

          // Feed audio chunks to mel worker from the main v4 audio handler below
          v4MelChunkUnsubscribe = null;

          // Process each audio chunk: energy VAD + write to BufferWorker + forward to TEN-VAD
          v4AudioChunkUnsubscribe = engine.onAudioChunk((chunk) => {
            if (!hybridVAD || !bufferClient) return;

            const chunkOffset = v4GlobalSampleOffset;
            v4GlobalSampleOffset += chunk.length;

            // 1. Run energy VAD (synchronous, fast) and write to BufferWorker
            const vadResult = hybridVAD.processEnergyOnly(chunk);
            const energyProb = vadResult.isSpeech ? 0.9 : 0.1;
            bufferClient.writeScalar('energyVad', energyProb);

            // 2. Forward audio to mel worker (copy, keep chunk for TEN-VAD transfer)
            melClient()?.pushAudioCopy(chunk);

            // 3. Forward audio to TEN-VAD worker for inference-based VAD (transfer, no copy)
            if (tenVADClient?.isReady()) {
              tenVADClient.processTransfer(chunk, chunkOffset);
            }

            // 4. Update VAD state for UI
            const sileroProbability = tenVADClient?.isReady()
              ? undefined
              : (vadResult.sileroProbability || 0);
            scheduleVadStateUpdate({
              isSpeech: vadResult.isSpeech,
              energy: vadResult.energy,
              snr: vadResult.snr || 0,
              hybridState: vadResult.state,
              ...(sileroProbability !== undefined ? { sileroProbability } : {}),
            });
          });

          // Start adaptive inference tick loop (reads interval from appStore)
          // Note: v4Tick internally checks if model is ready before running inference
          v4TickRunning = true;
          const scheduleNextTick = () => {
            if (!v4TickRunning) return;
            v4TickTimeout = window.setTimeout(async () => {
              if (!v4TickRunning) return;
              await v4Tick();
              scheduleNextTick();
            }, appStore.v4InferenceIntervalMs());
          };
          scheduleNextTick();

        } else if (isModelReady() && workerClient) {
          // v3 and v2 modes still require model to be ready
          if (mode === 'v3-streaming') {
            // ---- v3: Fixed-window token streaming (existing) ----
            const windowDur = appStore.streamingWindow();
            const triggerInt = appStore.triggerInterval();
            const overlapDur = Math.max(1.0, windowDur - triggerInt);

            await workerClient.initV3Service({
              windowDuration: windowDur,
              overlapDuration: overlapDur,
              sampleRate: 16000,
              frameStride: appStore.frameStride(),
            });

            let mel = melClient();
            if (!mel) {
              mel = new MelWorkerClient();
              setMelClient(mel);
            }
            try {
              await mel.init({ nMels: 128 });
            } catch (e) {
              mel.dispose();
              setMelClient(null);
            }

            melChunkUnsubscribe = engine.onAudioChunk((chunk) => {
              melClient()?.pushAudioCopy(chunk);
            });

            windowUnsubscribe = engine.onWindowChunk(
              windowDur,
              overlapDur,
              triggerInt,
              async (audio, startTime) => {
                if (!workerClient) return;
                const start = performance.now();

                let result;
                const mel = melClient();
                if (mel) {
                  const startSample = Math.round(startTime * 16000);
                  const endSample = startSample + audio.length;
                  const melFeatures = await mel.getFeatures(startSample, endSample);

                  if (melFeatures) {
                    result = await workerClient.processV3ChunkWithFeatures(
                      melFeatures.features,
                      melFeatures.T,
                      melFeatures.melBins,
                      startTime,
                      overlapDur,
                    );
                  } else {
                    result = await workerClient.processV3Chunk(audio, startTime);
                  }
                } else {
                  result = await workerClient.processV3Chunk(audio, startTime);
                }

                const duration = performance.now() - start;
                const stride = appStore.triggerInterval();
                appStore.setRtf(duration / (stride * 1000));
                appStore.setInferenceLatency(duration);

                // Use current engine variable
                const engine = audioEngine();
                if (engine) {
                  const ring = engine.getRingBuffer();
                  appStore.setBufferMetrics({
                    fillRatio: ring.getFillCount() / ring.getSize(),
                    latencyMs: (ring.getFillCount() / 16000) * 1000,
                  });
                }

                appStore.setMergeInfo({
                  lcsLength: result.lcsLength,
                  anchorValid: result.anchorValid,
                  chunkCount: result.chunkCount,
                  anchorTokens: result.anchorTokens
                });
              }
            );
          } else {
            // ---- v2: Per-utterance (existing) ----
            await workerClient.initService({ sampleRate: 16000 });
            segmentUnsubscribe = engine.onSpeechSegment(async (segment) => {
              if (workerClient) {
                const start = Date.now();
                // Use current engine variable
                const engine = audioEngine();
                if (!engine) return;
                const samples = engine.getRingBuffer().read(segment.startFrame, segment.endFrame);
                const result = await workerClient.transcribeSegment(samples);
                if (result.text) appStore.appendTranscript(result.text + ' ');
                appStore.setInferenceLatency(Date.now() - start);
              }
            });
          }
        }

        await engine.start();

        // Create WindowBuilder AFTER start() so we get the final RingBuffer reference
        // (AudioEngine.init() re-creates the RingBuffer internally)
        if (mode === 'v4-utterance') {
          windowBuilder = new WindowBuilder(
            engine.getRingBuffer(),
            null, // No VADRingBuffer; hasSpeech now goes through BufferWorker
            {
              sampleRate: 16000,
              minDurationSec: 3.0,
              maxDurationSec: 30.0,
              minInitialDurationSec: 1.5,
              useVadBoundaries: false, // VAD boundaries now managed by BufferWorker
              vadSilenceThreshold: 0.3,
              debug: true, // Enable debug logging for diagnostics
            }
          );
        }

        appStore.startRecording();

        energyPollInterval = window.setInterval(() => {
          const engine = audioEngine();
          if (engine) {
            appStore.setAudioLevel(engine.getCurrentEnergy());
            // Only set speech detected here for non-v4 modes (v4 handles it in VAD callback)
            if (appStore.transcriptionMode() !== 'v4-utterance') {
              appStore.setIsSpeechDetected(engine.isSpeechActive());
            }
          }
        }, 100);
      } catch (err: any) {
        appStore.setErrorMessage(err.message);
      }
    }
  };

  const loadModel = async (modelId: string) => {
    if (!workerClient) return;
    return workerClient.initModel(modelId);
  };

  const loadLocalModel = async (files: FileList) => {
    if (!workerClient) return;
    return workerClient.initLocalModel(files);
  };

  return {
    audioEngine,
    melClient,
    initialize,
    dispose,
    toggleRecording,
    loadModel,
    loadLocalModel
  };
}

export const recordingManager = createRoot(createRecordingManager);
