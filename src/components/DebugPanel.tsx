import { Component, createMemo, createSignal, onCleanup } from 'solid-js';
import { appStore } from '../stores/appStore';
import type { AudioEngine } from '../lib/audio/types';
import type { MelWorkerClient } from '../lib/audio/MelWorkerClient';
import { LayeredBufferVisualizer } from './LayeredBufferVisualizer';
import {
  DEFAULT_DEBUG_PANEL_HEIGHT,
  MAX_DEBUG_PANEL_HEIGHT,
  MIN_DEBUG_PANEL_HEIGHT,
} from '../utils/settingsStorage';

interface DebugPanelProps {
  /** Live audio engine used by buffer/debug visualizers. */
  audioEngine?: AudioEngine;
  /** Mel worker client used to render spectrogram layers. */
  melClient?: MelWorkerClient;
  /** Controlled panel height in px. */
  height?: number;
  /** Max panel height in px derived from parent layout. */
  maxHeight?: number;
  /** Called when the panel height changes via drag handle. */
  onHeightChange?: (height: number) => void;
}

/** Resizable diagnostics panel for runtime metrics, VAD state, and transcript internals. */
export const DebugPanel: Component<DebugPanelProps> = (props) => {
  const isRecording = () => appStore.recordingState() === 'recording';
  const widgetBadgeBaseClass =
    'px-1.5 py-0.5 rounded-md border border-[var(--color-earthy-sage)]/45 bg-[var(--color-earthy-bg)] text-[8px] font-bold uppercase tracking-wider';
  const widgetCardClass =
    'rounded-md border border-[var(--color-earthy-sage)]/45 bg-[var(--color-earthy-bg)]/95';
  const widgetSectionDividerClass = 'pt-1 border-t border-[var(--color-earthy-sage)]/35';
  const widgetPanelClass =
    'rounded-md border border-[var(--color-earthy-sage)]/45 bg-[var(--color-earthy-bg)]/70 overflow-hidden';

  const [internalHeight, setInternalHeight] = createSignal(DEFAULT_DEBUG_PANEL_HEIGHT);
  const [isResizing, setIsResizing] = createSignal(false);
  const getMaxHeight = () => {
    const viewportLimit = typeof window !== 'undefined' ? window.innerHeight - 200 : MAX_DEBUG_PANEL_HEIGHT;
    return Math.max(
      MIN_DEBUG_PANEL_HEIGHT,
      Math.min(props.maxHeight ?? MAX_DEBUG_PANEL_HEIGHT, viewportLimit, MAX_DEBUG_PANEL_HEIGHT)
    );
  };
  const clampPanelHeight = (height: number) =>
    Math.min(getMaxHeight(), Math.max(MIN_DEBUG_PANEL_HEIGHT, height));
  const panelHeight = () => clampPanelHeight(props.height ?? internalHeight());
  const setPanelHeight = (height: number) => {
    const clamped = clampPanelHeight(height);
    if (props.onHeightChange) {
      props.onHeightChange(clamped);
      return;
    }
    setInternalHeight(clamped);
  };

  let startY = 0;
  let startHeight = 0;
  let activePointerId: number | null = null;
  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    activePointerId = e.pointerId;
    startY = e.clientY;
    startHeight = panelHeight();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isResizing()) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const delta = startY - e.clientY;
    setPanelHeight(startHeight + delta);
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    setIsResizing(false);
    activePointerId = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  };

  onCleanup(() => {
    activePointerId = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
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
      class="bg-[var(--color-earthy-bg)] text-[10px] font-mono text-[var(--color-earthy-dark-brown)] flex flex-col overflow-hidden shrink-0 transition-colors duration-300 selection:bg-[var(--color-earthy-coral)]/20 selection:text-[var(--color-earthy-coral)]"
      style={{ height: `${panelHeight()}px` }}
    >
      {/* Single splitter: one line at top of handle + centered pill (no border-t on panel to avoid double line) */}
      <div
        class="h-3 shrink-0 cursor-row-resize group touch-none select-none flex items-center justify-center relative"
        onPointerDown={handlePointerDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize debug panel"
      >
        <div class={`relative z-10 h-2.5 w-10 rounded-full border shadow-sm transition-colors ${isResizing() ? 'bg-[var(--color-earthy-sage)] border-[var(--color-earthy-muted-green)]/80' : 'bg-[var(--color-earthy-bg)] border-[var(--color-earthy-sage)]/60 group-hover:border-[var(--color-earthy-soft-brown)]/80'}`} />
      </div>

      {/* Content area: below resize handle */}
      <div class="flex flex-1 min-h-0 pt-1 px-2 pb-2 gap-2 overflow-hidden">
      {/* ---- Column 1: Controls + signal telemetry ---- */}
      <div class={`${widgetPanelClass} w-60 flex flex-col p-2 gap-1.5 overflow-y-auto`}>
        <div class="flex flex-wrap gap-1">
          <span class={`${widgetBadgeBaseClass} text-[var(--color-earthy-dark-brown)]`}>
            Mode v4
          </span>
          <span class={`${widgetBadgeBaseClass} text-[var(--color-earthy-soft-brown)]`}>
            Backend {appStore.backend()}
          </span>
          <span class={`${widgetBadgeBaseClass} ${isRecording() ? 'border-[var(--color-earthy-coral)] text-[var(--color-earthy-coral)] bg-[var(--color-earthy-coral)]/10' : 'text-[var(--color-earthy-soft-brown)]'}`}>
            {isRecording() ? 'Recording' : 'Idle'}
          </span>
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

        <div class={`grid grid-cols-3 gap-1 ${widgetSectionDividerClass}`}>
          <div class={`${widgetCardClass} h-full px-1 py-0.5 text-center`}>
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Sent</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().sentencesFinalized}</div>
          </div>
          <div class={`${widgetCardClass} h-full px-1 py-0.5 text-center`}>
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Cursor</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.matureCursorTime().toFixed(1)}s</div>
          </div>
          <div class={`${widgetCardClass} h-full px-1 py-0.5 text-center`}>
            <div class="text-[7px] font-bold text-[var(--color-earthy-soft-brown)] uppercase">Win</div>
            <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)]">{appStore.v4MergerStats().utterancesProcessed}</div>
          </div>
        </div>

        <div class={`space-y-1 ${widgetSectionDividerClass}`}>
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
      </div>

      {/* ---- Column 2: compact diagnostics ---- */}
      <div class={`${widgetPanelClass} flex-1 flex flex-col min-w-0`}>
        <div class="flex-1 overflow-y-auto p-2 space-y-2">
          <section class="space-y-1">
            <div class="grid grid-cols-7 gap-1">
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">Inference Tick</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)] truncate">{appStore.v4InferenceIntervalMs()}ms</div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">Silence Flush</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)] truncate">{appStore.v4SilenceFlushSec().toFixed(1)}s</div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">VAD Threshold</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)] truncate">{(appStore.sileroThreshold() * 100).toFixed(0)}%</div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">RTFx</div>
                <div class={`text-[10px] font-bold truncate ${rtfColor()}`}>
                  {appStore.rtfxAverage() > 0 ? Math.round(appStore.rtfxAverage()) : '–'}
                </div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">Latency</div>
                <div class="text-[10px] font-bold text-[var(--color-earthy-dark-brown)] truncate">{Math.round(appStore.inferenceLatencyAverage())}ms</div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">State</div>
                <div class={`text-[10px] font-bold whitespace-nowrap overflow-hidden text-ellipsis ${appStore.vadState().isSpeech ? 'text-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
                  {appStore.vadState().hybridState}
                </div>
              </div>
              <div class={`${widgetCardClass} min-w-0 h-full p-1 transition-opacity duration-300 ${appStore.vadState().snr !== 0 ? 'opacity-100' : 'opacity-40'}`}>
                <div class="text-[7px] font-bold uppercase text-[var(--color-earthy-soft-brown)] truncate">SNR</div>
                <div class={`text-[10px] font-bold truncate ${appStore.vadState().snr > 3 ? 'text-[var(--color-earthy-muted-green)]' : 'text-[var(--color-earthy-soft-brown)]'}`}>
                  {appStore.vadState().snr.toFixed(1)} dB
                </div>
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
    </div>
  );
};
