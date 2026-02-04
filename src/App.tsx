/**
 * BoncukJS v3.0 - Main Application Component
 * 
 * Privacy-first, offline-capable real-time transcription.
 * Supports two modes:
 * - v2: Per-utterance VAD-based transcription
 * - v3: Overlapping window streaming with LCS+PTFA merge
 */

import { Component, Show, For, Switch, Match, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { appStore } from './stores/appStore';
import { CompactWaveform, BufferVisualizer, ModelLoadingOverlay, Sidebar, DebugPanel, StatusBar } from './components';
import { AudioEngine } from './lib/audio';
import { ModelManager, TranscriptionService, TokenStreamTranscriber } from './lib/transcription';

// Singleton instances
let audioEngine: AudioEngine | null = null;
// Reactive signal for UI components to access the engine
export const [audioEngineSignal, setAudioEngineSignal] = createSignal<AudioEngine | null>(null);

let modelManager: ModelManager | null = null;

// v2: Per-utterance transcription
let transcriptionService: TranscriptionService | null = null;
let segmentUnsubscribe: (() => void) | null = null;

// v3: Token stream transcription with LCS merge
let tokenStreamTranscriber: TokenStreamTranscriber | null = null;
let windowUnsubscribe: (() => void) | null = null;

let energyPollInterval: number | undefined;

const TranscriptPanel: Component = () => {
  const isRecording = () => appStore.recordingState() === 'recording';

  return (
    <section class="flex-1 flex flex-col min-w-0 nm-flat rounded-[40px] overflow-hidden relative z-10 transition-all duration-500">
      {/* Waveform Visualizer */}
      <Show when={isRecording()}>
        <div class="px-6 pt-6">
          <div class="rounded-3xl overflow-hidden nm-inset border-4 border-transparent">
            <BufferVisualizer
              audioEngine={audioEngineSignal() ?? undefined}
              height={100}
              showThreshold={true}
              snrThreshold={6.0}
              showTimeMarkers={true}
              visible={isRecording()}
            />
          </div>
        </div>
      </Show>

      {/* Transcript content area */}
      <div class="flex-1 overflow-y-auto px-6 pb-6 pt-2 relative group">

        {/* Floating Action Toolbar */}
        <div class="absolute top-8 right-12 z-20 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div class="nm-flat rounded-2xl px-4 py-2 flex items-center gap-4">
            <div class="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-slate-700">
              <div class={`w-1.5 h-1.5 rounded-full ${isRecording() ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />
              <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {formatDuration(appStore.sessionDuration())}
              </span>
            </div>

            <div class="flex gap-2">
              <button
                onClick={() => appStore.copyTranscript()}
                class="w-8 h-8 rounded-lg nm-button flex items-center justify-center text-slate-500 hover:text-blue-500 transition-all"
                title="Copy"
              >
                <span class="material-icons-round text-base">content_copy</span>
              </button>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({ title: 'BoncukJS Transcript', text: appStore.transcript() });
                  } else {
                    appStore.copyTranscript();
                  }
                }}
                class="w-8 h-8 rounded-lg nm-button flex items-center justify-center text-slate-500 hover:text-blue-500 transition-all"
                title="Share"
              >
                <span class="material-icons-round text-base">ios_share</span>
              </button>
              <button
                onClick={() => appStore.clearTranscript()}
                class="w-8 h-8 rounded-lg nm-button flex items-center justify-center text-slate-500 hover:text-red-500 transition-all"
                title="Clear"
              >
                <span class="material-icons-round text-base">delete_outline</span>
              </button>
            </div>
          </div>
        </div>

        <div class="nm-inset rounded-[32px] min-h-full p-10 leading-relaxed relative">
          <Show
            when={appStore.transcript() || appStore.pendingText()}
            fallback={
              <div class="h-full flex flex-col items-center justify-center text-center py-20 opacity-30">
                <span class="material-icons-round text-6xl mb-4">Chat_bubble_outline</span>
                <p class="text-lg font-medium">Ready to transcribe...</p>
              </div>
            }
          >
            <p class="text-xl text-slate-700 dark:text-slate-200 font-medium">
              {appStore.transcript()}
              <Show when={appStore.pendingText()}>
                <span class="text-blue-500/60 font-medium"> {appStore.pendingText()}</span>
              </Show>
            </p>
          </Show>
        </div>
      </div>
    </section>
  );
};

// Helper function
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Main App
const App: Component = () => {
  const [activeTab, setActiveTab] = createSignal('transcript');
  const [isDebugVisible, setIsDebugVisible] = createSignal(false);
  const [showModelOverlay, setShowModelOverlay] = createSignal(false);

  const isRecording = () => appStore.recordingState() === 'recording';
  const isModelReady = () => appStore.modelState() === 'ready';

  const toggleRecording = async () => {
    if (isRecording()) {
      // === STOP RECORDING ===
      if (energyPollInterval) {
        clearInterval(energyPollInterval);
        energyPollInterval = undefined;
      }
      audioEngine?.stop();

      // Cleanup subscriptions
      if (segmentUnsubscribe) {
        segmentUnsubscribe();
        segmentUnsubscribe = null;
      }
      if (windowUnsubscribe) {
        windowUnsubscribe();
        windowUnsubscribe = null;
      }

      // Finalize based on mode
      if (appStore.transcriptionMode() === 'v3-streaming' && tokenStreamTranscriber) {
        const final = tokenStreamTranscriber.finalize();
        appStore.setTranscript(final.confirmedText);
        appStore.setPendingText('');
        console.log('[App] v3 finalized:', final.chunkCount, 'chunks processed');
      } else if (transcriptionService) {
        const final = transcriptionService.finalize();
        if (final.text) {
          appStore.appendTranscript(final.text + ' ');
        }
      }

      appStore.setAudioLevel(0);
      appStore.stopRecording();
    } else {
      // === START RECORDING ===
      try {
        // Initialize audio engine if needed
        if (!audioEngine) {
          audioEngine = new AudioEngine({
            sampleRate: 16000,
            bufferDuration: 60, // Increased for v3 windowing
            energyThreshold: 0.01,
            minSpeechDuration: 80,
            minSilenceDuration: 400,
            maxSegmentDuration: 30.0,
            deviceId: appStore.selectedDeviceId(),
          });
          setAudioEngineSignal(audioEngine);
        } else {
          audioEngine.updateConfig({ deviceId: appStore.selectedDeviceId() });
        }

        const mode = appStore.transcriptionMode();
        console.log(`[App] Starting in ${mode} mode`);

        if (isModelReady() && modelManager) {
          if (mode === 'v3-streaming') {
            // === v3: Token Stream with LCS+PTFA merge ===
            if (!tokenStreamTranscriber) {
              tokenStreamTranscriber = new TokenStreamTranscriber(modelManager, {
                windowDuration: appStore.streamingWindow(),
                overlapDuration: appStore.streamingOverlap(),
                sampleRate: 16000,
                debug: true,
              }, {
                onConfirmedUpdate: (text) => {
                  appStore.setTranscript(text);
                },
                onPendingUpdate: (text) => {
                  appStore.setPendingText(text);
                },
                onMergeInfo: (info) => {
                  appStore.setMergeInfo({
                    lcsLength: info.lcsLength,
                    anchorValid: info.anchorValid,
                    chunkCount: tokenStreamTranscriber?.getState()?.chunkCount ?? 0,
                  });
                },
                onError: (err) => {
                  console.error('[v3] Error:', err);
                  appStore.setErrorMessage(err.message);
                },
              });
              await tokenStreamTranscriber.initialize();
              console.log('[App] v3 TokenStreamTranscriber initialized');
            } else {
              tokenStreamTranscriber.reset();
            }

            // Connect to fixed-window audio stream
            windowUnsubscribe = tokenStreamTranscriber.connectToAudioEngine(audioEngine);

          } else {
            // === v2: Per-utterance VAD-based transcription ===
            if (!transcriptionService) {
              transcriptionService = new TranscriptionService(modelManager, {
                sampleRate: 16000,
                returnTimestamps: true,
                returnConfidences: true,
                debug: true,
              }, {});
              transcriptionService.initialize();
              console.log('[App] v2 per-utterance mode initialized');
            }

            // Subscribe to VAD segments
            if (segmentUnsubscribe) segmentUnsubscribe();
            segmentUnsubscribe = audioEngine.onSpeechSegment(async (segment) => {
              if (transcriptionService && isModelReady()) {
                const startTime = Date.now();
                try {
                  const samples = audioEngine!.getRingBuffer().read(segment.startFrame, segment.endFrame);
                  const result = await transcriptionService.transcribeSegment(samples);

                  if (result.text) {
                    appStore.appendTranscript(result.text + ' ');

                    if (result.words && result.words.length > 0) {
                      const lastWords = result.words.slice(-5).map((w, i) => ({
                        id: `TOK_${Date.now()}_${i}`,
                        text: w.text,
                        confidence: w.confidence ?? 0
                      }));
                      appStore.setDebugTokens(prev => [...prev.slice(-15), ...lastWords]);

                      const avgConf = result.words.reduce((acc, w) => acc + (w.confidence || 0), 0) / result.words.length;
                      appStore.setSystemMetrics({
                        throughput: result.words.length / (segment.duration || 0.1),
                        modelConfidence: avgConf,
                      });
                    }
                  }

                  appStore.setInferenceLatency(Date.now() - startTime);
                } catch (e) {
                  console.error('[v2] Transcription error:', e);
                }
              }
            });
          }
        }

        await audioEngine.start();
        appStore.startRecording();

        // Poll energy for visualization
        energyPollInterval = window.setInterval(() => {
          if (audioEngine) {
            const energy = audioEngine.getCurrentEnergy();
            appStore.setAudioLevel(energy);
            appStore.setIsSpeechDetected(energy > 0.01);
          }
        }, 50);

      } catch (err: any) {
        console.error('Failed to start recording:', err);
        appStore.setErrorMessage(err.message || 'Microphone access denied. Please check site permissions.');
      }
    }
  };

  // Effect: Handle dynamic streaming config changes
  createEffect(() => {
    const windowDur = appStore.streamingWindow();
    const overlapDur = appStore.streamingOverlap();
    const isRecording = appStore.recordingState() === 'recording';
    const isV3 = appStore.transcriptionMode() === 'v3-streaming';

    // Only reconfigure if actively recording in v3 mode
    if (isRecording && isV3 && tokenStreamTranscriber && audioEngine) {
      console.log(`[App] Reconfiguring stream: window=${windowDur}s, overlap=${overlapDur}s`);

      if (windowUnsubscribe) {
        windowUnsubscribe();
        windowUnsubscribe = null;
      }

      tokenStreamTranscriber.updateConfig({
        windowDuration: windowDur,
        overlapDuration: overlapDur
      });

      tokenStreamTranscriber.reset(); // Reset context to avoid timestamp mismatch

      windowUnsubscribe = tokenStreamTranscriber.connectToAudioEngine(audioEngine);
    }
  });

  // Retry function for model loading
  const retryModelLoad = async () => {
    if (modelManager) {
      setShowModelOverlay(true);
      try {
        await modelManager.loadModel();
        appStore.setBackend(modelManager.getBackend());
        appStore.setIsOfflineReady(modelManager.isOfflineReady());
      } catch (e) {
        console.error('Failed to load model:', e);
      }
    }
  };

  // Function to load the selected model
  const loadSelectedModel = async () => {
    if (!modelManager) return;

    setShowModelOverlay(true);
    try {
      await modelManager.loadModel({ modelId: appStore.selectedModelId() });
      appStore.setBackend(modelManager.getBackend());
      appStore.setIsOfflineReady(modelManager.isOfflineReady());
      // Auto-close on success? Maybe not, let user see "Ready" state or explicitly close?
      // ModelManager sets state to 'ready'. Overlay might show something.
      // If we want to auto-close, we can do it here. But user might want to see 'Ready' message.
      // Current behavior: shows 'ready' state.
      setTimeout(() => setShowModelOverlay(false), 1500); // Auto-close shortly after ready
    } catch (e) {
      console.error('Failed to load model:', e);
    }
  };

  // Function to load model from local files
  const handleLocalLoad = async (files: FileList) => {
    if (!modelManager) return;

    setShowModelOverlay(true);
    try {
      await modelManager.loadLocalModel(files);
      appStore.setBackend(modelManager.getBackend());
      appStore.setIsOfflineReady(modelManager.isOfflineReady());
      setTimeout(() => setShowModelOverlay(false), 1500);
    } catch (e) {
      console.error('Failed to side-load local model:', e);
    }
  };

  // Initialize model manager on mount (but don't load yet)
  onMount(() => {
    modelManager = new ModelManager({
      onProgress: (progress) => {
        appStore.setModelProgress(progress.progress);
        appStore.setModelMessage(progress.message || '');
        appStore.setModelFile(progress.file || '');
      },
      onStateChange: (state) => {
        appStore.setModelState(state);
      },
      onError: (error) => {
        console.error('Model error:', error);
        appStore.setModelMessage(error.message);
      },
    });

    // Refresh devices on mount
    appStore.refreshDevices();
  });


  // Cleanup on unmount
  onCleanup(() => {
    if (energyPollInterval) clearInterval(energyPollInterval);
    audioEngine?.dispose();
    modelManager?.dispose();
  });

  return (
    <div class="h-screen w-full overflow-hidden flex flex-col bg-[var(--nm-bg)] dark:bg-[var(--nm-bg-dark)] text-slate-800 dark:text-slate-100 font-sans selection:bg-primary selection:text-white transition-colors duration-300">
      {/* Model Selection & Loading Overlay */}
      <ModelLoadingOverlay
        isVisible={showModelOverlay()}
        state={appStore.modelState()}
        progress={appStore.modelProgress()}
        message={appStore.modelMessage()}
        file={appStore.modelFile()}
        backend={appStore.backend()}
        selectedModelId={appStore.selectedModelId()}
        onModelSelect={appStore.setSelectedModelId}
        onStart={loadSelectedModel}
        onLocalLoad={handleLocalLoad}
        onClose={() => setShowModelOverlay(false)}
      />

      {/* Error Toast */}
      <Show when={appStore.errorMessage()}>
        {(msg) => (
          <div
            class="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] bg-red-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 cursor-pointer animate-bounce"
            onClick={() => appStore.setErrorMessage(null)}
          >
            <span class="material-icons-round">error_outline</span>
            <span class="font-bold">{msg()}</span>
            <span class="text-white/60 text-xs ml-2">Click to dismiss</span>
          </div>
        )}
      </Show>




      <main class="flex-1 flex overflow-hidden p-4 gap-6 relative">
        <Sidebar
          activeTab={activeTab()}
          onTabChange={setActiveTab}
          onToggleDebug={() => setIsDebugVisible(!isDebugVisible())}
          isRecording={isRecording()}
          onToggleRecording={toggleRecording}
          isModelReady={isModelReady()}
          onLoadModel={() => setShowModelOverlay(true)}
          modelState={appStore.modelState()}
          availableDevices={appStore.availableDevices()}
          selectedDeviceId={appStore.selectedDeviceId()}
          onDeviceSelect={(id) => {
            appStore.setSelectedDeviceId(id);
            audioEngine?.setDevice(id);
          }}
          audioLevel={appStore.audioLevel()}
        />

        <div class="flex-1 flex flex-col min-w-0 min-h-0">
          <Switch>
            <Match when={activeTab() === 'transcript'}>
              <TranscriptPanel />
            </Match>
            <Match when={activeTab() === 'ai'}>
              <div class="flex-1 nm-flat rounded-[40px] p-10 flex flex-col transition-all">
                <h2 class="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-8 px-2">AI Engine Status</h2>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div class="p-6 rounded-3xl nm-inset group transition-all">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Active Model</div>
                    <div class="text-xl font-bold text-slate-700 dark:text-slate-200 truncate px-1">{appStore.selectedModelId()}</div>
                  </div>

                  <div class="p-6 rounded-3xl nm-inset group transition-all">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Inference Backend</div>
                    <div class="text-xl font-bold text-slate-700 dark:text-slate-200 px-1">{appStore.backend().toUpperCase()}</div>
                  </div>

                  <div class="p-6 rounded-3xl nm-inset group transition-all">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Offline Readiness</div>
                    <div class="flex items-center gap-2 px-1">
                      <div class={`w-2 h-2 rounded-full ${appStore.isOfflineReady() ? 'bg-green-500' : 'bg-amber-500'}`} />
                      <div class="text-xl font-bold text-slate-700 dark:text-slate-200">{appStore.isOfflineReady() ? 'Ready' : 'Streaming'}</div>
                    </div>
                  </div>
                </div>

                <div class="mt-auto px-2">
                  <div class="p-6 rounded-3xl nm-inset bg-blue-500/5">
                    <p class="text-sm text-slate-500 leading-relaxed italic">
                      "Speech is processed entirely on your device. Your audio never leaves this browser tab."
                    </p>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </main>

      <DebugPanel
        isVisible={isDebugVisible()}
        onClose={() => setIsDebugVisible(false)}
        audioEngine={audioEngineSignal() ?? undefined}
      />

      <StatusBar />

      {/* Global SVG Filters for Hardware Effects */}
      <svg style="position: absolute; width: 0; height: 0; overflow: hidden;" aria-hidden="true">
        <defs>
          <filter id="mercury">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
    </div>
  );
};


export default App;
