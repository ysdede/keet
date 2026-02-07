import { createSignal } from 'solid-js';
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

// Export signals for UI binding
export const [audioEngineSignal, setAudioEngineSignal] = createSignal<AudioEngine | null>(null);
export const [melClientSignal, setMelClientSignal] = createSignal<MelWorkerClient | null>(null);

export class RecordingManager {
  private static instance: RecordingManager;

  // Singleton instances
  private audioEngine: AudioEngine | null = null;
  private workerClient: TranscriptionWorkerClient | null = null;
  private melClient: MelWorkerClient | null = null;

  private segmentUnsubscribe: (() => void) | null = null;
  private windowUnsubscribe: (() => void) | null = null;
  private melChunkUnsubscribe: (() => void) | null = null;
  private energyPollInterval: number | undefined;

  // v4 pipeline instances
  private hybridVAD: HybridVAD | null = null;
  private bufferClient: BufferWorkerClient | null = null;
  private tenVADClient: TenVADWorkerClient | null = null;
  private windowBuilder: WindowBuilder | null = null;
  private v4TickTimeout: number | undefined;
  private v4TickRunning = false;
  private v4AudioChunkUnsubscribe: (() => void) | null = null;
  private v4MelChunkUnsubscribe: (() => void) | null = null;
  private v4InferenceBusy = false;
  private v4LastInferenceTime = 0;

  // Global sample counter for audio chunks (tracks total samples written to BufferWorker)
  private v4GlobalSampleOffset = 0;

  // Throttle UI updates from TEN-VAD to at most once per frame
  private pendingSileroProb: number | null = null;
  private sileroUpdateScheduled = false;
  private pendingVadState: {
    isSpeech: boolean;
    energy: number;
    snr: number;
    hybridState: string;
    sileroProbability?: number;
  } | null = null;
  private vadUpdateScheduled = false;

  private v4TickCount = 0;
  private v4ModelNotReadyLogged = false;

  public static getInstance(): RecordingManager {
    if (!RecordingManager.instance) {
      RecordingManager.instance = new RecordingManager();
    }
    return RecordingManager.instance;
  }

  public initialize() {
    this.workerClient = new TranscriptionWorkerClient();

    this.workerClient.onModelProgress = (p) => {
      appStore.setModelProgress(p.progress);
      appStore.setModelMessage(p.message || '');
      if (p.file) appStore.setModelFile(p.file);
    };

    this.workerClient.onModelStateChange = (s) => {
      appStore.setModelState(s);
    };

    this.workerClient.onV3Confirmed = (text) => {
      appStore.setTranscript(text);
    };

    this.workerClient.onV3Pending = (text) => {
      appStore.setPendingText(text);
    };

    this.workerClient.onError = (msg) => {
      appStore.setErrorMessage(msg);
    };

    appStore.refreshDevices();
  }

  public dispose() {
    if (this.energyPollInterval) clearInterval(this.energyPollInterval);
    this.cleanupV4Pipeline();
    this.melClient?.dispose();
    this.workerClient?.dispose();
  }

  private scheduleSileroUpdate(prob: number) {
    this.pendingSileroProb = prob;
    if (this.sileroUpdateScheduled) return;
    this.sileroUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.sileroUpdateScheduled = false;
      if (this.pendingSileroProb === null) return;
      const currentState = appStore.vadState();
      appStore.setVadState({
        ...currentState,
        sileroProbability: this.pendingSileroProb,
      });
    });
  }

  private scheduleVadStateUpdate(next: {
    isSpeech: boolean;
    energy: number;
    snr: number;
    hybridState: string;
    sileroProbability?: number;
  }) {
    this.pendingVadState = next;
    if (this.vadUpdateScheduled) return;
    this.vadUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.vadUpdateScheduled = false;
      if (!this.pendingVadState) return;
      const currentState = appStore.vadState();
      const sileroProbability =
        this.pendingVadState.sileroProbability !== undefined
          ? this.pendingVadState.sileroProbability
          : currentState.sileroProbability;
      appStore.setVadState({
        ...currentState,
        ...this.pendingVadState,
        sileroProbability,
      });
      appStore.setIsSpeechDetected(this.pendingVadState.isSpeech);
      this.pendingVadState = null;
    });
  }

  // ---- v4 pipeline tick: periodic window building + inference ----
  private v4Tick = async () => {
    if (!this.workerClient || !this.windowBuilder || !this.audioEngine || !this.bufferClient || this.v4InferenceBusy) return;

    // Skip inference if model is not ready (but still allow audio/mel/VAD to process)
    if (appStore.modelState() !== 'ready') {
      if (!this.v4ModelNotReadyLogged) {
        console.log('[v4Tick] Model not ready yet - audio is being captured and preprocessed');
        this.v4ModelNotReadyLogged = true;
      }
      return;
    }
    // Reset the flag once model becomes ready
    if (this.v4ModelNotReadyLogged) {
      console.log('[v4Tick] Model is now ready - starting inference');
      this.v4ModelNotReadyLogged = false;
      // Initialize the v4 service now that model is ready
      await this.workerClient.initV4Service({ debug: false });
    }

    this.v4TickCount++;
    const now = performance.now();
    // Use the store's configurable inference interval (minus a small margin for the tick jitter)
    const minInterval = Math.max(200, appStore.v4InferenceIntervalMs() - 100);
    if (now - this.v4LastInferenceTime < minInterval) return;

    // Check if there is speech via the BufferWorker (async query).
    // We check both energy and inference VAD layers; either one detecting speech triggers inference.
    const cursorSample = this.windowBuilder.getMatureCursorFrame(); // frame === sample in our pipeline
    const currentSample = this.v4GlobalSampleOffset;
    const startSample = cursorSample > 0 ? cursorSample : 0;

    let hasSpeech = false;
    if (currentSample > startSample) {
      // Check energy VAD first (always available, low latency)
      const energyResult = await this.bufferClient.hasSpeech('energyVad', startSample, currentSample, 0.3);

      // When inference VAD is ready, require BOTH energy AND inference to agree
      // This prevents false positives from music/noise that has high energy but no speech
      if (this.tenVADClient?.isReady()) {
        const inferenceResult = await this.bufferClient.hasSpeech('inferenceVad', startSample, currentSample, 0.5);
        // Require both energy and inference VAD to agree (AND logic)
        hasSpeech = energyResult.hasSpeech && inferenceResult.hasSpeech;
      } else {
        // Fall back to energy-only if inference VAD is not available
        hasSpeech = energyResult.hasSpeech;
      }
    }

    if (this.v4TickCount <= 5 || this.v4TickCount % 20 === 0) {
      const vadState = appStore.vadState();
      const rb = this.audioEngine.getRingBuffer();
      const rbFrame = rb.getCurrentFrame();
      const rbBase = rb.getBaseFrameOffset();
      console.log(
        `[v4Tick #${this.v4TickCount}] hasSpeech=${hasSpeech}, vadState=${vadState.hybridState}, ` +
        `energy=${vadState.energy.toFixed(4)}, inferenceVAD=${(vadState.sileroProbability || 0).toFixed(2)}, ` +
        `samples=[${startSample}:${currentSample}], ` +
        `ringBuf=[base=${rbBase}, head=${rbFrame}, avail=${rbFrame - rbBase}]`
      );
    }

    // Periodic buffer worker state dump (every 40 ticks)
    if (this.v4TickCount % 40 === 0 && this.bufferClient) {
      try {
        const state = await this.bufferClient.getState();
        const layerSummary = Object.entries(state.layers)
          .map(([id, l]) => `${id}:${l.fillCount}/${l.maxEntries}@${l.currentSample}`)
          .join(', ');
        console.log(`[v4Tick #${this.v4TickCount}] BufferState: ${layerSummary}`);
      } catch (_) { /* ignore state query errors */ }
    }

    if (!hasSpeech) {
      // Check for silence-based flush using BufferWorker
      const silenceDuration = await this.bufferClient.getSilenceTailDuration('energyVad', 0.3);
      if (silenceDuration >= appStore.v4SilenceFlushSec()) {
        // Flush pending sentence via timeout finalization
        try {
          const flushResult = await this.workerClient.v4FinalizeTimeout();
          if (flushResult) {
            appStore.setMatureText(flushResult.matureText);
            appStore.setImmatureText(flushResult.immatureText);
            appStore.setMatureCursorTime(flushResult.matureCursorTime);
            appStore.setTranscript(flushResult.fullText);
            // Advance window builder cursor
            this.windowBuilder.advanceMatureCursorByTime(flushResult.matureCursorTime);
          }
        } catch (err) {
          console.error('[v4Tick] Flush error:', err);
        }
      }
      return;
    }

    // Build window from cursor to current position
    const window = this.windowBuilder.buildWindow();
    if (!window) {
      if (this.v4TickCount <= 10 || this.v4TickCount % 20 === 0) {
        const rb = this.audioEngine.getRingBuffer();
        const rbHead = rb.getCurrentFrame();
        const rbBase = rb.getBaseFrameOffset();
        console.log(
          `[v4Tick #${this.v4TickCount}] buildWindow=null, ` +
          `ringBuf=[base=${rbBase}, head=${rbHead}, avail=${rbHead - rbBase}], ` +
          `cursor=${this.windowBuilder.getMatureCursorFrame()}`
        );
      }
      return;
    }

    console.log(`[v4Tick #${this.v4TickCount}] Window [${window.startFrame}:${window.endFrame}] ${window.durationSeconds.toFixed(2)}s (initial=${window.isInitial})`);

    this.v4InferenceBusy = true;
    this.v4LastInferenceTime = now;

    try {
      const inferenceStart = performance.now();

      // Get mel features for the window
      let features: { features: Float32Array; T: number; melBins: number } | null = null;
      if (this.melClient) {
        features = await this.melClient.getFeatures(window.startFrame, window.endFrame);
      }

      if (!features) {
        this.v4InferenceBusy = false;
        return;
      }

      // Calculate time offset for absolute timestamps
      const timeOffset = window.startFrame / 16000;

      // Calculate incremental cache parameters
      const cursorFrame = this.windowBuilder.getMatureCursorFrame();
      const prefixSeconds = cursorFrame > 0 ? (window.startFrame - cursorFrame) / 16000 : 0;

      const result: V4ProcessResult = await this.workerClient.processV4ChunkWithFeatures({
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
      if (result.matureCursorTime > this.windowBuilder.getMatureCursorTime()) {
        appStore.setMatureCursorTime(result.matureCursorTime);
        this.windowBuilder.advanceMatureCursorByTime(result.matureCursorTime);
        this.windowBuilder.markSentenceEnd(Math.round(result.matureCursorTime * 16000));
      }

      // Update stats
      appStore.setV4MergerStats({
        sentencesFinalized: result.matureSentenceCount,
        cursorUpdates: result.stats?.matureCursorUpdates || 0,
        utterancesProcessed: result.stats?.utterancesProcessed || 0,
      });

      // Update buffer metrics
      const ring = this.audioEngine.getRingBuffer();
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
      this.v4InferenceBusy = false;
    }
  };

  private cleanupV4Pipeline() {
    this.v4TickRunning = false;
    if (this.v4TickTimeout) {
      clearTimeout(this.v4TickTimeout);
      this.v4TickTimeout = undefined;
    }
    if (this.v4AudioChunkUnsubscribe) {
      this.v4AudioChunkUnsubscribe();
      this.v4AudioChunkUnsubscribe = null;
    }
    if (this.v4MelChunkUnsubscribe) {
      this.v4MelChunkUnsubscribe();
      this.v4MelChunkUnsubscribe = null;
    }
    this.hybridVAD = null;
    if (this.tenVADClient) {
      this.tenVADClient.dispose();
      this.tenVADClient = null;
    }
    if (this.bufferClient) {
      this.bufferClient.dispose();
      this.bufferClient = null;
    }
    this.windowBuilder = null;
    this.v4InferenceBusy = false;
    this.v4LastInferenceTime = 0;
    this.v4GlobalSampleOffset = 0;
  }

  public async toggleRecording() {
    const isRecording = () => appStore.recordingState() === 'recording';
    const isModelReady = () => appStore.modelState() === 'ready';

    if (isRecording()) {
      if (this.energyPollInterval) {
        clearInterval(this.energyPollInterval);
        this.energyPollInterval = undefined;
      }
      this.audioEngine?.stop();

      if (this.segmentUnsubscribe) this.segmentUnsubscribe();
      if (this.windowUnsubscribe) this.windowUnsubscribe();
      if (this.melChunkUnsubscribe) this.melChunkUnsubscribe();
      this.cleanupV4Pipeline();

      if (this.workerClient) {
        const final = await this.workerClient.finalize();
        const text = (final as any).text || (final as any).fullText || '';
        appStore.setTranscript(text);
        appStore.setPendingText('');
      }

      this.melClient?.reset();
      // Don't nullify melClient here, just reset it, but if needed we can set null
      // Actually we keep the instance if possible, but let's see.
      // The current logic doesn't clear melClient variable here, only calls .reset()
      // So signal should remain valid.
      this.audioEngine?.reset();
      appStore.setAudioLevel(0);
      appStore.stopRecording();
    } else {
      try {
        if (!this.audioEngine) {
          this.audioEngine = new AudioEngine({
            sampleRate: 16000,
            deviceId: appStore.selectedDeviceId(),
          });
          setAudioEngineSignal(this.audioEngine);
        } else {
          this.audioEngine.updateConfig({ deviceId: appStore.selectedDeviceId() });
          this.audioEngine.reset();
        }

        const mode = appStore.transcriptionMode();

        // v4 mode: Always start audio capture, mel preprocessing, and VAD
        // Inference only runs when model is ready (checked in v4Tick)
        if (mode === 'v4-utterance') {
          // ---- v4: Utterance-based pipeline with BufferWorker + TEN-VAD ----

          // Initialize merger in worker only if model is ready
          if (isModelReady() && this.workerClient) {
            await this.workerClient.initV4Service({ debug: false });
          }

          // Initialize mel worker (always needed for preprocessing)
          if (!this.melClient) {
            this.melClient = new MelWorkerClient();
            setMelClientSignal(this.melClient);
          }
          try {
            await this.melClient.init({ nMels: 128 });
          } catch (e) {
            this.melClient.dispose();
            this.melClient = null;
            setMelClientSignal(null);
          }

          // Initialize BufferWorker (centralized multi-layer data store)
          this.bufferClient = new BufferWorkerClient();
          const bufferConfig: BufferWorkerConfig = {
            sampleRate: 16000,
            layers: {
              audio: { hopSamples: 1, entryDimension: 1, maxDurationSec: 120 },
              mel: { hopSamples: 160, entryDimension: 128, maxDurationSec: 120 },
              energyVad: { hopSamples: 1280, entryDimension: 1, maxDurationSec: 120 },
              inferenceVad: { hopSamples: 256, entryDimension: 1, maxDurationSec: 120 },
            },
          };
          await this.bufferClient.init(bufferConfig);

          // Initialize TEN-VAD worker (inference-based VAD)
          this.tenVADClient = new TenVADWorkerClient();
          this.tenVADClient.onResult((result: TenVADResult) => {
            if (!this.bufferClient) return;
            // Batch-write hop probabilities to inferenceVad (single worker message)
            if (result.hopCount > 0) {
              const lastProb = result.probabilities[result.hopCount - 1];
              if (this.bufferClient.writeBatchTransfer) {
                this.bufferClient.writeBatchTransfer('inferenceVad', result.probabilities, result.globalSampleOffset);
              } else {
                this.bufferClient.writeBatch('inferenceVad', result.probabilities, result.globalSampleOffset);
              }

              // Update UI at most once per frame with the latest probability
              this.scheduleSileroUpdate(lastProb);
            }
          });
          // TEN-VAD init is non-blocking; falls back gracefully if WASM fails
          this.tenVADClient.init({ hopSize: 256, threshold: 0.5 }).catch((err) => {
            console.warn('[v4] TEN-VAD init failed, using energy-only:', err);
          });

          // Initialize hybrid VAD for energy-based detection (always runs, fast)
          this.hybridVAD = new HybridVAD({
            sileroThreshold: 0.5,
            onsetConfirmations: 2,
            offsetConfirmations: 3,
            sampleRate: 16000,
          });
          // Do NOT init Silero in HybridVAD (TEN-VAD replaces it)

          // NOTE: WindowBuilder is created AFTER audioEngine.start() below,
          // because start() may re-create the internal RingBuffer.

          // Reset global sample counter
          this.v4GlobalSampleOffset = 0;

          // Feed audio chunks to mel worker from the main v4 audio handler below
          this.v4MelChunkUnsubscribe = null;

          // Process each audio chunk: energy VAD + write to BufferWorker + forward to TEN-VAD
          this.v4AudioChunkUnsubscribe = this.audioEngine.onAudioChunk((chunk) => {
            if (!this.hybridVAD || !this.bufferClient) return;

            const chunkOffset = this.v4GlobalSampleOffset;
            this.v4GlobalSampleOffset += chunk.length;

            // 1. Run energy VAD (synchronous, fast) and write to BufferWorker
            const vadResult = this.hybridVAD.processEnergyOnly(chunk);
            const energyProb = vadResult.isSpeech ? 0.9 : 0.1;
            this.bufferClient.writeScalar('energyVad', energyProb);

            // 2. Forward audio to mel worker (copy, keep chunk for TEN-VAD transfer)
            this.melClient?.pushAudioCopy(chunk);

            // 3. Forward audio to TEN-VAD worker for inference-based VAD (transfer, no copy)
            if (this.tenVADClient?.isReady()) {
              this.tenVADClient.processTransfer(chunk, chunkOffset);
            }

            // 4. Update VAD state for UI
            const sileroProbability = this.tenVADClient?.isReady()
              ? undefined
              : (vadResult.sileroProbability || 0);
            this.scheduleVadStateUpdate({
              isSpeech: vadResult.isSpeech,
              energy: vadResult.energy,
              snr: vadResult.snr || 0,
              hybridState: vadResult.state,
              ...(sileroProbability !== undefined ? { sileroProbability } : {}),
            });
          });

          // Start adaptive inference tick loop (reads interval from appStore)
          // Note: v4Tick internally checks if model is ready before running inference
          this.v4TickRunning = true;
          const scheduleNextTick = () => {
            if (!this.v4TickRunning) return;
            this.v4TickTimeout = window.setTimeout(async () => {
              if (!this.v4TickRunning) return;
              await this.v4Tick();
              scheduleNextTick();
            }, appStore.v4InferenceIntervalMs());
          };
          scheduleNextTick();

        } else if (isModelReady() && this.workerClient) {
          // v3 and v2 modes still require model to be ready
          if (mode === 'v3-streaming') {
            // ---- v3: Fixed-window token streaming (existing) ----
            const windowDur = appStore.streamingWindow();
            const triggerInt = appStore.triggerInterval();
            const overlapDur = Math.max(1.0, windowDur - triggerInt);

            await this.workerClient.initV3Service({
              windowDuration: windowDur,
              overlapDuration: overlapDur,
              sampleRate: 16000,
              frameStride: appStore.frameStride(),
            });

            if (!this.melClient) {
              this.melClient = new MelWorkerClient();
              setMelClientSignal(this.melClient);
            }
            try {
              await this.melClient.init({ nMels: 128 });
            } catch (e) {
              this.melClient.dispose();
              this.melClient = null;
              setMelClientSignal(null);
            }

            this.melChunkUnsubscribe = this.audioEngine.onAudioChunk((chunk) => {
              this.melClient?.pushAudioCopy(chunk);
            });

            this.windowUnsubscribe = this.audioEngine.onWindowChunk(
              windowDur,
              overlapDur,
              triggerInt,
              async (audio, startTime) => {
                if (!this.workerClient) return;
                const start = performance.now();

                let result;
                if (this.melClient) {
                  const startSample = Math.round(startTime * 16000);
                  const endSample = startSample + audio.length;
                  const melFeatures = await this.melClient.getFeatures(startSample, endSample);

                  if (melFeatures) {
                    result = await this.workerClient.processV3ChunkWithFeatures(
                      melFeatures.features,
                      melFeatures.T,
                      melFeatures.melBins,
                      startTime,
                      overlapDur,
                    );
                  } else {
                    result = await this.workerClient.processV3Chunk(audio, startTime);
                  }
                } else {
                  result = await this.workerClient.processV3Chunk(audio, startTime);
                }

                const duration = performance.now() - start;
                const stride = appStore.triggerInterval();
                appStore.setRtf(duration / (stride * 1000));
                appStore.setInferenceLatency(duration);

                if (this.audioEngine) {
                  const ring = this.audioEngine.getRingBuffer();
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
            await this.workerClient.initService({ sampleRate: 16000 });
            this.segmentUnsubscribe = this.audioEngine.onSpeechSegment(async (segment) => {
              if (this.workerClient) {
                const start = Date.now();
                const samples = this.audioEngine!.getRingBuffer().read(segment.startFrame, segment.endFrame);
                const result = await this.workerClient.transcribeSegment(samples);
                if (result.text) appStore.appendTranscript(result.text + ' ');
                appStore.setInferenceLatency(Date.now() - start);
              }
            });
          }
        }

        await this.audioEngine.start();

        // Create WindowBuilder AFTER start() so we get the final RingBuffer reference
        // (AudioEngine.init() re-creates the RingBuffer internally)
        if (mode === 'v4-utterance') {
          this.windowBuilder = new WindowBuilder(
            this.audioEngine.getRingBuffer(),
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

        this.energyPollInterval = window.setInterval(() => {
          if (this.audioEngine) {
            appStore.setAudioLevel(this.audioEngine.getCurrentEnergy());
            // Only set speech detected here for non-v4 modes (v4 handles it in VAD callback)
            if (appStore.transcriptionMode() !== 'v4-utterance') {
              appStore.setIsSpeechDetected(this.audioEngine.isSpeechActive());
            }
          }
        }, 100);
      } catch (err: any) {
        appStore.setErrorMessage(err.message);
      }
    }
  }

  public async loadModel(modelId: string) {
    if (!this.workerClient) return;
    return this.workerClient.initModel(modelId);
  }

  public async loadLocalModel(files: FileList) {
    if (!this.workerClient) return;
    return this.workerClient.initLocalModel(files);
  }
}

export const recordingManager = RecordingManager.getInstance();
