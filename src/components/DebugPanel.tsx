import { Component, createMemo, For, Show, createSignal, onCleanup, createEffect } from 'solid-js';
import { appStore, type TranscriptionMode } from '../stores/appStore';
import type { AudioEngine } from '../lib/audio/types';
import type { MelWorkerClient } from '../lib/audio/MelWorkerClient';
import { LayeredBufferVisualizer } from './LayeredBufferVisualizer';

interface DebugPanelProps {
  audioEngine?: AudioEngine;
  melClient?: MelWorkerClient;
}

const MODES: { id: TranscriptionMode; label: string; short: string }[] = [
  { id: 'v4-utterance', label: 'Utterance (v4)', short: 'v4' },
  { id: 'v3-streaming', label: 'Streaming (v3)', short: 'v3' },
  { id: 'v2-utterance', label: 'Legacy (v2)', short: 'v2' },
];

export const DebugPanel: Component<DebugPanelProps> = (props) => {
  const isRecording = () => appStore.recordingState() === 'recording';
  const isV4 = () => appStore.transcriptionMode() === 'v4-utterance';
  const isV3 = () => appStore.transcriptionMode() === 'v3-streaming';

  const [height, setHeight] = createSignal(260);
  const [isResizing, setIsResizing] = createSignal(false);

  let startY = 0;
  let startHeight = 0;
  let scrollContainer: HTMLDivElement | undefined;

  // Auto-scroll to bottom of finalized sentences
  createEffect(() => {
    appStore.matureText(); // Track dependency
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  });

  const handleMouseDown = (e: MouseEvent) => {
    setIsResizing(true);
    startY = e.clientY;
    startHeight = height();
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing()) return;
    const delta = startY - e.clientY;
    const newHeight = Math.min(Math.max(startHeight + delta, 150), 600);
    setHeight(newHeight);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  onCleanup(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });

  const rtfColor = createMemo(() => {
    const rtfx = appStore.rtfxAverage();
    if (rtfx === 0) return 'text-[var(--color-earthy-soft-brown)]';
    if (rtfx >= 2) return 'text-[var(--color-earthy-muted-green)] font-bold';
    if (rtfx >= 1) return 'text-[var(--color-earthy-coral)] font-bold';
    return 'text-[var(--color-earthy-coral)] font-bold';
  });

  return (
    <div
      class="bg-[var(--color-earthy-bg)] border-t border-[var(--color-earthy-sage)] text-[10px] font-mono text-[var(--color-earthy-dark-brown)] flex overflow-hidden shrink-0 transition-colors duration-300 selection:bg-[var(--color-earthy-coral)]/20 selection:text-[var(--color-earthy-coral)] z-20 relative"
      style={{ height: `${height()}px` }}
    >
      {/* Resize Handle */}
      <div
        class="absolute top-0 left-0 w-full h-1 cursor-ns-resize z-50 hover:bg-[var(--color-earthy-muted-green)]/50 transition-colors bg-transparent"
        onMouseDown={handleMouseDown}
      />

      {/* ---- Column 1: System & Signal (merged indicators) ---- */}
      <div class="w-60 flex flex-col p-3 gap-2.5 border-r border-[var(--color-earthy-sage)] bg-[var(--color-earthy-sage)]/10 overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-[var(--color-earthy-sage)]">
          <span class="font-bold tracking-wider uppercase text-[var(--color-earthy-soft-brown)]">System & Signal</span>
          <div class="flex items-center gap-2">
            <span class="font-bold text-[var(--color-earthy-soft-brown)] uppercase text-[9px]">{appStore.backend()}</span>
            <div class={`w-2 h-2 rounded-full border border-[var(--color-earthy-bg)] shadow-sm transition-all duration-300 ${isRecording() ? 'bg-[var(--color-earthy-coral)] animate-pulse' : 'bg-[var(--color-earthy-sage)]'}`} />
            <span class={`font-bold text-white bg-[var(--color-earthy-coral)] px-1.5 py-px rounded text-[9px] transition-opacity duration-100 ${appStore.isSpeechDetected() ? 'opacity-100 animate-pulse' : 'opacity-0'}`}>VAD</span>
          </div>
        </div>

        <div class="space-y-1.5">
          <span class="font-bold text-[9px] text-[var(--color-earthy-soft-brown)] uppercase tracking-wider">Mode</span>
          <div class="flex gap-1">
            <For each={MODES}>
              {(mode) => (
                <button
                  class={`flex-1 px-1 py-1 rounded text-[9px] font-bold uppercase tracking-wide border transition-all ${appStore.transcriptionMode() === mode.id
                    ? 'bg-[var(--color-earthy-muted-green)] text-white border-[var(--color-earthy-muted-green)] shadow-sm'
                    : 'bg-[var(--color-earthy-bg)] text-[var(--color-earthy-soft-brown)] border-[var(--color-earthy-sage)] hover:border-[var(--color-earthy-soft-brown)] hover:bg-[var(--color-earthy-sage)]/20'
                    } ${isRecording() ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => {
                    if (!isRecording()) {
                      appStore.setTranscriptionMode(mode.id);
                    }
                  }}
                  disabled={isRecording()}
                  title={isRecording() ? 'Stop recording to change mode' : mode.label}
                >
                  {mode.short}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-1.5">
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 flex flex-col items-center justify-center">
            <span class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-tight text-[8px] mb-0.5">RTFx</span>
            <span class={`text-xs ${rtfColor()}`}>
              {appStore.rtfxAverage() > 0 ? Math.round(appStore.rtfxAverage()) : '–'}
            </span>
          </div>
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 flex flex-col items-center justify-center">
            <span class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-tight text-[8px] mb-0.5">Latency</span>
            <span class="text-xs font-bold text-[var(--color-earthy-dark-brown)]">{Math.round(appStore.inferenceLatencyAverage())}ms</span>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex justify-between font-bold text-[var(--color-earthy-soft-brown)] uppercase px-0.5 text-[9px]">
            <span>Buffer</span>
            <span>{(appStore.bufferMetrics().fillRatio * 100).toFixed(0)}%</span>
          </div>
          <div class="h-1.5 w-full bg-[var(--color-earthy-sage)] rounded-full overflow-hidden">
            <div
              class="h-full bg-[var(--color-earthy-muted-green)] transition-all duration-300 ease-out rounded-full"
              style={{ width: `${(appStore.bufferMetrics().fillRatio * 100).toFixed(0)}%` }}
            />
          </div>
        </div>

        <Show when={isV4()}>
          <div class="space-y-1 pt-1 border-t border-[var(--color-earthy-sage)]">
            <span class="font-bold text-[8px] text-[var(--color-earthy-soft-brown)] uppercase tracking-wider">Merger</span>
            <div class="grid grid-cols-3 gap-1">
              <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
                <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Sent</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().sentencesFinalized}</div>
              </div>
              <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
                <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Cursor</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.matureCursorTime().toFixed(1)}s</div>
              </div>
              <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
                <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Uttr</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().utterancesProcessed}</div>
              </div>
            </div>
          </div>
        </Show>

        <div class="space-y-1">
          <div class="flex justify-between font-bold text-[var(--color-earthy-soft-brown)] uppercase text-[9px]">
            <span>RMS Energy</span>
            <span class={appStore.audioLevel() > appStore.energyThreshold() ? 'text-[var(--color-earthy-muted-green)]' : 'text-[var(--color-earthy-soft-brown)]'}>
              {(appStore.audioLevel() * 100).toFixed(1)}%
            </span>
          </div>
          <div class="h-2 w-full bg-[var(--color-earthy-sage)] rounded overflow-hidden relative">
            <div class="absolute top-0 bottom-0 w-px bg-[var(--color-earthy-coral)] z-10" style={{ left: `${appStore.energyThreshold() * 100}%` }} title="Energy threshold"></div>
            <div
              class={`h-full transition-all duration-75 ${appStore.isSpeechDetected() ? 'bg-[var(--color-earthy-coral)]' : 'bg-[var(--color-earthy-muted-green)]'}`}
              style={{ width: `${Math.min(100, appStore.audioLevel() * 100)}%` }}
            />
          </div>
        </div>

        <Show when={isV4()}>
          <div class={`space-y-1 transition-opacity duration-300 ${appStore.vadState().sileroProbability > 0 ? 'opacity-100' : 'opacity-40'}`}>
            <div class="flex justify-between font-bold text-[var(--color-earthy-soft-brown)] uppercase text-[9px]">
              <span>VAD Prob</span>
              <span class={appStore.vadState().sileroProbability > appStore.sileroThreshold() ? 'text-[var(--color-earthy-coral)] font-bold' : 'text-[var(--color-earthy-soft-brown)]'}>
                {(appStore.vadState().sileroProbability * 100).toFixed(0)}%
              </span>
            </div>
            <div class="h-2 w-full bg-[var(--color-earthy-sage)] rounded overflow-hidden relative">
              <div class="absolute top-0 bottom-0 w-px bg-[var(--color-earthy-coral)] z-10" style={{ left: `${appStore.sileroThreshold() * 100}%` }} title="VAD threshold"></div>
              <div
                class={`h-full transition-all duration-75 ${appStore.vadState().sileroProbability > appStore.sileroThreshold() ? 'bg-[var(--color-earthy-coral)]' : 'bg-[var(--color-earthy-soft-brown)]'}`}
                style={{ width: `${Math.min(100, appStore.vadState().sileroProbability * 100)}%` }}
              />
            </div>
          </div>
          <div class={`flex justify-between items-center bg-[var(--color-earthy-bg)] p-1.5 rounded border border-[var(--color-earthy-sage)] transition-opacity duration-300 ${appStore.vadState().snr !== 0 ? 'opacity-100' : 'opacity-40'}`}>
            <span class="font-bold text-[9px] text-[var(--color-earthy-soft-brown)] uppercase">SNR</span>
            <span class={`font-bold text-[10px] ${appStore.vadState().snr > 3 ? 'text-[var(--color-earthy-muted-green)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
              {appStore.vadState().snr.toFixed(1)} dB
            </span>
          </div>
        </Show>

        <div class="grid grid-cols-2 gap-1.5 pt-1 border-t border-[var(--color-earthy-sage)]">
          <Show when={isV3()}>
            <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 text-center">
              <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">Overlap</div>
              <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.streamingOverlap().toFixed(1)}s</div>
            </div>
            <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 text-center">
              <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">Chunks</div>
              <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.mergeInfo().chunkCount}</div>
            </div>
          </Show>
          <Show when={isV4()}>
            <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 text-center">
              <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">State</div>
              <div class={`text-[10px] font-bold whitespace-nowrap w-24 overflow-hidden text-ellipsis mx-auto ${appStore.vadState().isSpeech ? 'text-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
                {appStore.vadState().hybridState}
              </div>
            </div>
            <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1.5 text-center">
              <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">Windows</div>
              <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().utterancesProcessed}</div>
            </div>
          </Show>
        </div>
      </div>

      {/* ---- Column 2: Live Context (mode-dependent) ---- */}
      <div class="flex-1 flex flex-col min-w-0 bg-[var(--color-earthy-bg)]">
        <div class="px-3 py-2 border-b border-[var(--color-earthy-sage)] bg-[var(--color-earthy-sage)]/10 flex items-center justify-between">
          <span class="font-bold tracking-wider uppercase text-[var(--color-earthy-soft-brown)]">
            {isV4() ? 'Transcript State' : isV3() ? 'Stream Sync' : 'Segments'}
          </span>

          {/* v3: LCS indicators */}
          <Show when={isV3()}>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--color-earthy-bg)] rounded border border-[var(--color-earthy-sage)]">
                <div class={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${appStore.mergeInfo().anchorValid ? 'bg-[var(--color-earthy-muted-green)]' : 'bg-[var(--color-earthy-coral)]'}`} />
                <span class="font-bold uppercase text-[var(--color-earthy-soft-brown)] tracking-wide">Lock</span>
              </div>
              <div class="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--color-earthy-bg)] rounded border border-[var(--color-earthy-sage)]">
                <span class="material-symbols-outlined text-[14px] text-[var(--color-earthy-soft-brown)]">join_inner</span>
                <span class="font-bold uppercase text-[var(--color-earthy-dark-brown)]">Match: <span class="text-[var(--color-earthy-muted-green)]">{appStore.mergeInfo().lcsLength}</span></span>
              </div>
            </div>
          </Show>

          {/* v4: VAD state indicator */}
          <Show when={isV4()}>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--color-earthy-bg)] rounded border border-[var(--color-earthy-sage)]">
                <div class={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${appStore.vadState().isSpeech ? 'bg-[var(--color-earthy-coral)] animate-pulse' : 'bg-[var(--color-earthy-sage)]'}`} />
                <div class="w-24 overflow-hidden text-ellipsis whitespace-nowrap">
                  <span class="font-bold uppercase text-[var(--color-earthy-soft-brown)] tracking-wide">{appStore.vadState().hybridState}</span>
                </div>
              </div>
              <div class={`flex items-center gap-1.5 px-2 py-0.5 bg-[var(--color-earthy-bg)] rounded border border-[var(--color-earthy-sage)] transition-opacity duration-300 ${appStore.vadState().sileroProbability > 0 ? 'opacity-100' : 'opacity-0'}`}>
                <span class="font-bold uppercase text-[var(--color-earthy-soft-brown)] text-[9px]">VAD</span>
                <span class={`font-bold ${appStore.vadState().sileroProbability > 0.5 ? 'text-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
                  {(appStore.vadState().sileroProbability * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </Show>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
          {/* v4: Mature + Immature text display */}
          <Show when={isV4()}>
            <div class="space-y-3">
              {/* Mature (finalized) sentences */}
              <div class="space-y-1.5">
                <h4 class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-widest flex items-center gap-2 text-[9px]">
                  <span class="w-1.5 h-1.5 bg-[var(--color-earthy-muted-green)] rounded-full"></span>
                  Finalized Sentences
                </h4>
                <div
                  ref={scrollContainer}
                  class="p-2 border border-[var(--color-earthy-sage)] bg-[var(--color-earthy-muted-green)]/10 rounded h-32 overflow-y-auto resize-y"
                >
                  <Show when={appStore.matureText()} fallback={
                    <span class="text-[var(--color-earthy-soft-brown)] italic text-[10px] opacity-50">No finalized sentences yet...</span>
                  }>
                    <span class="text-[11px] text-[var(--color-earthy-dark-brown)] leading-relaxed">{appStore.matureText()}</span>
                  </Show>
                </div>
              </div>

              {/* Immature (active) sentence */}
              <div class="space-y-1.5">
                <h4 class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-widest flex items-center gap-2 text-[9px]">
                  <span class="w-1.5 h-1.5 bg-[var(--color-earthy-coral)] rounded-full animate-pulse"></span>
                  Active Sentence
                </h4>
                <div class="p-2 border border-[var(--color-earthy-coral)]/30 bg-[var(--color-earthy-coral)]/10 rounded min-h-[36px]">
                  <Show when={appStore.immatureText()} fallback={
                    <span class="text-[var(--color-earthy-soft-brown)] italic text-[10px] opacity-50">Waiting for speech...</span>
                  }>
                    <span class="text-[11px] text-[var(--color-earthy-coral)] italic leading-relaxed">{appStore.immatureText()}</span>
                    <span class="inline-block w-0.5 h-3 bg-[var(--color-earthy-coral)] animate-pulse ml-0.5 align-middle"></span>
                  </Show>
                </div>
              </div>

              {/* Pending sentence info */}
              <Show when={appStore.v4MergerStats().sentencesFinalized > 0}>
                <div class="text-[9px] text-[var(--color-earthy-soft-brown)] flex items-center gap-3 pt-1">
                  <span>{appStore.v4MergerStats().sentencesFinalized} sentences finalized</span>
                  <span class="text-[var(--color-earthy-sage)]">|</span>
                  <span>Cursor at {appStore.matureCursorTime().toFixed(2)}s</span>
                  <span class="text-[var(--color-earthy-sage)]">|</span>
                  <span>{appStore.v4MergerStats().utterancesProcessed} windows processed</span>
                </div>
              </Show>
            </div>
          </Show>

          {/* v3: Transition cache + anchors */}
          <Show when={isV3()}>
            <div class="space-y-2">
              <h4 class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-widest flex items-center gap-2 text-[9px]">
                <span class="w-1 h-1 bg-[var(--color-earthy-sage)] rounded-full"></span>
                Transition Cache
              </h4>
              <div class="p-2 border border-[var(--color-earthy-sage)] bg-[var(--color-earthy-sage)]/10 rounded min-h-[48px] flex flex-wrap gap-1.5 content-start">
                <For each={appStore.debugTokens().slice(-24)}>
                  {(token) => (
                    <div
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors"
                      style={{
                        "background-color": token.confidence > 0.8 ? '#F9F7F2' : 'rgba(249,247,242,0.6)',
                        "border-color": `rgba(107, 112, 92, ${Math.max(0.2, token.confidence * 0.4)})`,
                        "color": token.confidence > 0.8 ? '#3D405B' : '#A5A58D',
                        "opacity": Math.max(0.5, token.confidence)
                      }}
                      title={`Confidence: ${(token.confidence * 100).toFixed(0)}%`}
                    >
                      {token.text}
                    </div>
                  )}
                </For>
                <Show when={appStore.pendingText()}>
                  <span class="px-1.5 py-0.5 text-[var(--color-earthy-coral)] font-medium italic border border-dashed border-[var(--color-earthy-coral)]/30 rounded bg-[var(--color-earthy-coral)]/10">
                    {appStore.pendingText()}...
                  </span>
                </Show>
                <Show when={!appStore.debugTokens().length && !appStore.pendingText()}>
                  <span class="text-[var(--color-earthy-soft-brown)] italic text-[10px] w-full text-center py-2 op-50">Waiting for speech input...</span>
                </Show>
              </div>
            </div>

            <div class="space-y-2">
              <h4 class="font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-widest flex items-center gap-2 text-[9px]">
                <span class="w-1 h-1 bg-[var(--color-earthy-muted-green)] rounded-full"></span>
                Stable Anchors
              </h4>
              <div class="flex flex-wrap gap-1">
                <For each={appStore.mergeInfo().anchorTokens || []}>
                  {(token) => (
                    <span class="px-1.5 py-0.5 bg-[var(--color-earthy-muted-green)]/20 text-[var(--color-earthy-muted-green)] border border-[var(--color-earthy-sage)] rounded font-medium">
                      {token}
                    </span>
                  )}
                </For>
                <Show when={!appStore.mergeInfo().anchorTokens?.length}>
                  <span class="text-[var(--color-earthy-soft-brown)] text-[10px] italic px-1 opacity-50">No stable anchors locked yet.</span>
                </Show>
              </div>
            </div>
          </Show>

          {/* v2: basic info */}
          <Show when={!isV3() && !isV4()}>
            <div class="text-[var(--color-earthy-soft-brown)] italic text-center py-4">
              Legacy per-utterance mode. Segments are transcribed individually.
            </div>
          </Show>

          {/* New Layered Buffer Visualizer */}
          <div class="pt-2 border-t border-[var(--color-earthy-sage)]">
            <LayeredBufferVisualizer
              audioEngine={props.audioEngine}
              melClient={props.melClient}
              height={120} // Compact height
              windowDuration={8.0}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
