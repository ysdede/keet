import { Component, createMemo, createSignal, onCleanup } from 'solid-js';
import { appStore } from '../stores/appStore';
import type { AudioEngine } from '../lib/audio/types';
import type { MelWorkerClient } from '../lib/audio/MelWorkerClient';
import { LayeredBufferVisualizer } from './LayeredBufferVisualizer';
import {
  clampDebugPanelHeight,
  DEFAULT_DEBUG_PANEL_HEIGHT,
} from '../utils/settingsStorage';

interface DebugPanelProps {
  /** Live audio engine used by buffer/debug visualizers. */
  audioEngine?: AudioEngine;
  /** Mel worker client used to render spectrogram layers. */
  melClient?: MelWorkerClient;
  /** Controlled panel height in px. */
  height?: number;
  /** Called when the panel height changes via drag handle. */
  onHeightChange?: (height: number) => void;
}

/** Resizable diagnostics panel for runtime metrics, VAD state, and transcript internals. */
export const DebugPanel: Component<DebugPanelProps> = (props) => {
  const isRecording = () => appStore.recordingState() === 'recording';

  const [internalHeight, setInternalHeight] = createSignal(DEFAULT_DEBUG_PANEL_HEIGHT);
  const [isResizing, setIsResizing] = createSignal(false);
  const panelHeight = () => clampDebugPanelHeight(props.height ?? internalHeight());
  const setPanelHeight = (height: number) => {
    const clamped = clampDebugPanelHeight(height);
    if (props.onHeightChange) {
      props.onHeightChange(clamped);
      return;
    }
    setInternalHeight(clamped);
  };

  let startY = 0;
  let startHeight = 0;
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startY = e.clientY;
    startHeight = panelHeight();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing()) return;
    const delta = startY - e.clientY;
    setPanelHeight(startHeight + delta);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  onCleanup(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
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
      style={{ height: `${panelHeight()}px` }}
    >
      {/* Resize Handle */}
      <div
        class="absolute top-0 left-0 right-0 h-3 cursor-row-resize z-50 group touch-none select-none"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize debug panel"
      >
        <div class={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-10 rounded-full border shadow-sm transition-colors ${isResizing() ? 'bg-[var(--color-earthy-sage)] border-[var(--color-earthy-muted-green)]/80' : 'bg-[var(--color-earthy-bg)] border-[var(--color-earthy-sage)]/60 group-hover:border-[var(--color-earthy-soft-brown)]/80'}`} />
      </div>

      {/* ---- Column 1: Controls + signal telemetry ---- */}
      <div class="w-60 flex flex-col p-2 gap-1.5 border-r border-[var(--color-earthy-sage)] bg-[var(--color-earthy-sage)]/10 overflow-y-auto">
        <div class="flex flex-wrap gap-1">
          <span class="px-1.5 py-0.5 rounded border border-[var(--color-earthy-sage)] bg-[var(--color-earthy-bg)] text-[8px] font-bold uppercase tracking-wider text-[var(--color-earthy-dark-brown)]">
            Mode v4
          </span>
          <span class="px-1.5 py-0.5 rounded border border-[var(--color-earthy-sage)] bg-[var(--color-earthy-bg)] text-[8px] font-bold uppercase tracking-wider text-[var(--color-earthy-soft-brown)]">
            Backend {appStore.backend()}
          </span>
          <span class={`px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wider ${isRecording() ? 'border-[var(--color-earthy-coral)] text-[var(--color-earthy-coral)] bg-[var(--color-earthy-coral)]/10' : 'border-[var(--color-earthy-sage)] text-[var(--color-earthy-soft-brown)] bg-[var(--color-earthy-bg)]'}`}>
            {isRecording() ? 'Recording' : 'Idle'}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-1">
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

        <div class="grid grid-cols-3 gap-1 pt-1 border-t border-[var(--color-earthy-sage)]">
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Sent</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().sentencesFinalized}</div>
          </div>
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Cursor</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.matureCursorTime().toFixed(1)}s</div>
          </div>
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded px-1 py-0.5 text-center">
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Win</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().utterancesProcessed}</div>
          </div>
        </div>

        <div class="space-y-1 pt-1 border-t border-[var(--color-earthy-sage)]">
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
        <div class="grid grid-cols-2 gap-1 pt-1 border-t border-[var(--color-earthy-sage)]">
          <div class="bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1 text-center">
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">State</div>
            <div class={`text-[10px] font-bold whitespace-nowrap w-24 overflow-hidden text-ellipsis mx-auto ${appStore.vadState().isSpeech ? 'text-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
              {appStore.vadState().hybridState}
            </div>
          </div>
          <div class={`bg-[var(--color-earthy-bg)] border border-[var(--color-earthy-sage)] rounded p-1 text-center transition-opacity duration-300 ${appStore.vadState().snr !== 0 ? 'opacity-100' : 'opacity-40'}`}>
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase mb-px">SNR</div>
            <div class={`text-[10px] font-bold ${appStore.vadState().snr > 3 ? 'text-[var(--color-earthy-muted-green)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
              {appStore.vadState().snr.toFixed(1)} dB
            </div>
          </div>
        </div>
      </div>

      {/* ---- Column 2: compact diagnostics ---- */}
      <div class="flex-1 flex flex-col min-w-0 bg-[var(--color-earthy-bg)]">
        <div class="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
          <section class="space-y-1">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div class="bg-[var(--color-earthy-sage)]/10 border border-[var(--color-earthy-sage)] rounded p-1.5">
                <div class="text-[8px] font-bold uppercase text-[var(--color-earthy-soft-brown)]">Inference Tick</div>
                <div class="text-[11px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4InferenceIntervalMs()}ms</div>
              </div>
              <div class="bg-[var(--color-earthy-sage)]/10 border border-[var(--color-earthy-sage)] rounded p-1.5">
                <div class="text-[8px] font-bold uppercase text-[var(--color-earthy-soft-brown)]">Silence Flush</div>
                <div class="text-[11px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4SilenceFlushSec().toFixed(1)}s</div>
              </div>
              <div class="bg-[var(--color-earthy-sage)]/10 border border-[var(--color-earthy-sage)] rounded p-1.5">
                <div class="text-[8px] font-bold uppercase text-[var(--color-earthy-soft-brown)]">VAD Threshold</div>
                <div class="text-[11px] font-bold text-[var(--color-earthy-dark-brown)]">{(appStore.sileroThreshold() * 100).toFixed(0)}%</div>
              </div>
            </div>
          </section>

          <section class="pt-1 border-t border-[var(--color-earthy-sage)] space-y-1">
            <LayeredBufferVisualizer
              audioEngine={props.audioEngine}
              melClient={props.melClient}
              height={138}
              windowDuration={8.0}
            />
            <div class="text-[8px] text-[var(--color-earthy-soft-brown)]/80">
              Visualizes rolling 8-second context. Use this section for speech activity and spectral continuity checks.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
