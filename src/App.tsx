import { Component, Show, For, Switch, Match, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { appStore } from './stores/appStore';
import { CompactWaveform, BufferVisualizer, ModelLoadingOverlay, Sidebar, DebugPanel, StatusBar, TranscriptionDisplay } from './components';
import { recordingManager, audioEngineSignal, melClientSignal } from './lib/recording/RecordingManager';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h.toString().padStart(2, '0') + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const Header: Component<{ isRecording: boolean, audioLevel: number }> = (props) => {
  return (
    <header class="bg-white border-b border-slate-200 shrink-0 z-10 transition-all duration-300">
      <div class="px-8 h-20 flex items-center justify-between">
        <div class="flex items-center gap-10">
          <div>
            <h1 class="text-xl font-extrabold text-[#0f172a] tracking-tight">Boncuk AI</h1>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="flex h-2 w-2">
                <span class={`absolute inline-flex h-2 w-2 rounded-full opacity-75 ${props.isRecording ? 'animate-ping bg-red-400' : 'bg-slate-300'}`}></span>
                <span class={`relative inline-flex rounded-full h-2 w-2 ${props.isRecording ? 'bg-red-500' : 'bg-slate-400'}`}></span>
              </span>
              <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {props.isRecording ? 'Live' : 'Standby'}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-8 border-l border-slate-100 pl-10">
            <div class="flex flex-col">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</span>
              <span class="text-sm font-bold text-slate-700 capitalize">
                {appStore.selectedModelId().split('-').slice(0, 2).join(' ')}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inference</span>
              <span class="text-sm font-bold text-slate-700">
                {appStore.inferenceLatency().toFixed(0)} ms
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Duration</span>
              <span class="text-sm font-bold text-slate-700">{formatDuration(appStore.sessionDuration())}</span>
            </div>
          </div>
        </div>

        <div class="flex-1 max-w-md h-12 mx-12 flex items-center justify-center">
          <CompactWaveform audioLevel={props.audioLevel} isRecording={props.isRecording} />
        </div>

        <div class="flex items-center gap-4">
          <div class="text-right mr-2 hidden sm:block">
            <p class="text-xs font-bold text-slate-700">On-Device AI</p>
            <p class="text-[10px] text-slate-500">{appStore.backend().toUpperCase()} Backend</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-neu-bg shadow-neu-flat flex items-center justify-center border border-slate-100">
            <span class="material-symbols-outlined text-primary">shield</span>
          </div>
        </div>
      </div>
    </header>
  );
};

const App: Component = () => {
  const [activeTab, setActiveTab] = createSignal('transcript');
  const [showModelOverlay, setShowModelOverlay] = createSignal(false);

  const isRecording = () => appStore.recordingState() === 'recording';
  const isModelReady = () => appStore.modelState() === 'ready';

  onMount(() => {
    recordingManager.initialize();
  });

  onCleanup(() => {
    recordingManager.dispose();
  });

  const toggleRecording = async () => {
    await recordingManager.toggleRecording();
  };

  const loadSelectedModel = async () => {
    setShowModelOverlay(true);
    try {
      await recordingManager.loadModel(appStore.selectedModelId());
      setTimeout(() => setShowModelOverlay(false), 1500);
    } catch (e) { }
  };

  const openModelSelection = () => {
    if (appStore.modelState() !== 'loading' && appStore.modelState() !== 'ready') {
      appStore.setModelState('unloaded');
    }
    setShowModelOverlay(true);
  };

  const handleLocalLoad = async (files: FileList) => {
    setShowModelOverlay(true);
    try {
      await recordingManager.loadLocalModel(files);
      setTimeout(() => setShowModelOverlay(false), 1500);
    } catch (e) {
      console.error('Failed to load local model:', e);
    }
  };

  return (
    <div class="h-screen bg-neu-bg flex overflow-hidden selection:bg-primary/20">
      <ModelLoadingOverlay
        isVisible={showModelOverlay()}
        state={appStore.modelState()}
        progress={appStore.modelProgress()}
        message={appStore.modelMessage()}
        file={appStore.modelFile()}
        backend={appStore.backend()}
        selectedModelId={appStore.selectedModelId()}
        onModelSelect={(id: string) => appStore.setSelectedModelId(id)}
        onStart={() => loadSelectedModel()}
        onLocalLoad={handleLocalLoad}
        onClose={() => setShowModelOverlay(false)}
      />

      <Sidebar
        activeTab={activeTab()}
        onTabChange={setActiveTab}
        isRecording={isRecording()}
        onToggleRecording={toggleRecording}
        isModelReady={isModelReady()}
        onLoadModel={openModelSelection}
        modelState={appStore.modelState()}
        availableDevices={appStore.availableDevices()}
        selectedDeviceId={appStore.selectedDeviceId()}
        onDeviceSelect={(id: string) => {
          appStore.setSelectedDeviceId(id);
          const engine = audioEngineSignal();
          if (engine) {
            engine.updateConfig({ deviceId: id });
          }
        }}
        audioLevel={appStore.audioLevel()}
      />

      <main class="flex-1 flex flex-col min-w-0 bg-workspace-bg overflow-hidden">
        <Header isRecording={isRecording()} audioLevel={appStore.audioLevel()} />

        <div class="flex-1 overflow-y-auto relative">
          <Switch>
            <Match when={activeTab() === 'transcript'}>
              <div class="px-8 py-10 max-w-5xl mx-auto w-full h-full">
                <TranscriptionDisplay
                  confirmedText={appStore.transcriptionMode() === 'v4-utterance' ? appStore.matureText() : appStore.transcript()}
                  pendingText={appStore.transcriptionMode() === 'v4-utterance' ? appStore.immatureText() : appStore.pendingText()}
                  isRecording={isRecording()}
                  lcsLength={appStore.mergeInfo().lcsLength}
                  anchorValid={appStore.mergeInfo().anchorValid}
                  showConfidence={appStore.transcriptionMode() === 'v3-streaming'}
                  class="h-full"
                />
              </div>
            </Match>
            <Match when={activeTab() === 'settings'}>
              <div class="px-12 py-10 max-w-5xl mx-auto w-full">
                <h2 class="text-2xl font-extrabold text-[#0f172a] mb-8">System Settings</h2>
                <div class="nm-flat rounded-3xl p-8 space-y-8">
                  <section>
                    <h3 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Device Configuration</h3>
                    <p class="text-slate-600">Model: <span class="font-bold text-primary">{appStore.selectedModelId()}</span></p>
                    <p class="text-slate-600">Backend: <span class="font-bold text-primary">{appStore.backend().toUpperCase()}</span></p>
                  </section>
                </div>
              </div>
            </Match>
          </Switch>
        </div>

        {/* Floating Metrics Block */}
        <div class="fixed top-24 right-8 flex gap-4 z-30">
          <div class="bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl border border-slate-200 shadow-lg flex items-center gap-4 transition-all hover:shadow-xl hover:bg-white">
            <div class="flex flex-col">
              <span class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">RTF</span>
              <span class={`text-xs font-bold ${appStore.rtf() > 1 ? 'text-red-500' : 'text-slate-900'}`}>{appStore.rtf().toFixed(2)}</span>
            </div>
            <div class="w-px h-5 bg-slate-200"></div>
            <button
              onClick={() => appStore.copyTranscript()}
              class="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg hover:bg-blue-600 transition-all shadow-md active:scale-95 active:shadow-sm"
            >
              <span class="material-symbols-outlined text-[14px]">content_copy</span>
              <span>Copy</span>
            </button>
            <div class="w-px h-5 bg-slate-200"></div>
            <button
              onClick={() => appStore.setShowDebugPanel(!appStore.showDebugPanel())}
              class={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all shadow-md active:scale-95 active:shadow-sm ${appStore.showDebugPanel() ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
              title={appStore.showDebugPanel() ? 'Hide debug panel (improves performance)' : 'Show debug panel'}
            >
              <span class="material-symbols-outlined text-[14px]">{appStore.showDebugPanel() ? 'bug_report' : 'bug_report'}</span>
              <span>{appStore.showDebugPanel() ? 'Debug' : 'Debug'}</span>
            </button>
          </div>
        </div>

        <Show when={appStore.showDebugPanel()}>
          <DebugPanel
            audioEngine={audioEngineSignal() ?? undefined}
            melClient={melClientSignal() ?? undefined}
          />
        </Show>
      </main>
    </div>
  );
};

export default App;
