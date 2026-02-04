import { Component, For, Show } from 'solid-js';
import { appStore } from '../stores/appStore';
import { EnergyMeter } from './EnergyMeter';
import { AudioEngine } from '../lib/audio/types';

interface DebugPanelProps {
  isVisible: boolean;
  onClose: () => void;
  audioEngine?: AudioEngine;
}

export const DebugPanel: Component<DebugPanelProps> = (props) => {
  return (
    <div
      class={`h-80 nm-inset mx-6 mb-6 rounded-[32px] transition-all duration-300 flex-col font-mono text-[11px] overflow-hidden ${props.isVisible ? 'flex' : 'hidden'
        }`}
    >
      <div class="flex items-center justify-between px-6 py-4 bg-transparent border-b border-slate-200/50 dark:border-slate-800/50">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <span class="material-icons-round text-blue-500 text-lg">terminal</span>
            <span class="font-black text-slate-700 dark:text-slate-200 tracking-tighter uppercase">Boncuk_Debugger</span>
          </div>

          <div class="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-2"></div>

          {/* Mode Toggle */}
          <div class="flex items-center gap-1 nm-flat rounded-xl p-1">
            <button
              class={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest transition-all ${appStore.transcriptionMode() === 'v2-utterance'
                ? 'nm-inset text-blue-500'
                : 'text-slate-400 hover:text-slate-200'
                }`}
              onClick={() => appStore.setTranscriptionMode('v2-utterance')}
            >
              V2_VAD
            </button>
            <button
              class={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest transition-all ${appStore.transcriptionMode() === 'v3-streaming'
                ? 'nm-inset text-blue-500'
                : 'text-slate-400 hover:text-slate-200'
                }`}
              onClick={() => appStore.setTranscriptionMode('v3-streaming')}
            >
              V3_LCS
            </button>
          </div>
        </div>

        <div class="flex items-center gap-6">
          <div class="nm-flat rounded-xl px-3 py-1 flex items-center gap-2">
            <span class="text-slate-400 font-bold uppercase text-[9px]">Latency</span>
            <span class="text-blue-500 font-black">{appStore.inferenceLatency()}ms</span>
          </div>
          <button class="w-8 h-8 rounded-lg nm-button flex items-center justify-center text-slate-400 hover:text-red-500 transition-all" onClick={() => props.onClose()}>
            <span class="material-icons-round text-base">close</span>
          </button>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden p-4 gap-4">
        {/* Token Stream */}
        <div class="flex-1 nm-inset rounded-2xl p-4 overflow-y-auto bg-slate-500/5">
          <div class="flex items-center justify-between mb-4 px-1">
            <h3 class="text-slate-400 uppercase tracking-widest font-black text-[9px]">Stream_Buffer</h3>
            <span class="text-[9px] font-bold text-slate-500 px-2 py-0.5 nm-flat rounded-full">LIVE</span>
          </div>
          <div class="space-y-1">
            <For each={appStore.debugTokens()}
              fallback={<div class="text-slate-400 italic text-center py-10 opacity-50 underline decoration-dotted">No input detected...</div>}>
              {(token) => (
                <div class={`flex justify-between items-center px-3 py-1.5 rounded-xl transition-all ${token.confidence < 0.5 ? 'bg-amber-500/10 text-amber-500' : 'hover:bg-blue-500/5'}`}>
                  <span class="text-blue-500 font-bold opacity-70">{token.id.slice(-4)}</span>
                  <span class="text-slate-700 dark:text-slate-200 font-bold">"{token.text}"</span>
                  <span class="text-slate-400 font-black">{(token.confidence * 100).toFixed(0)}%</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Inference State */}
        <div class="w-1/3 nm-inset rounded-2xl p-4 overflow-y-auto bg-slate-500/5 flex flex-col gap-4">
          <div>
            <h3 class="text-slate-400 uppercase tracking-widest font-black text-[9px] mb-4 px-1">Engine_State</h3>
            <div class="nm-flat rounded-xl p-3 bg-slate-900/90 text-[10px]">
              <pre class="text-emerald-500 leading-relaxed font-bold">{JSON.stringify({
                "backend": appStore.backend(),
                "ready": appStore.isOfflineReady(),
                "audio": appStore.audioLevel().toFixed(4),
                "vad": appStore.isSpeechDetected()
              }, null, 2)}</pre>
            </div>
          </div>

          <div class="mt-auto">
            <EnergyMeter audioEngine={props.audioEngine} />
          </div>
        </div>

        {/* System Metrics */}
        <div class="flex-1 nm-inset rounded-2xl p-4 overflow-y-auto bg-slate-500/5 flex flex-col">
          <h3 class="text-slate-400 uppercase tracking-widest font-black text-[9px] mb-4 px-1">Perf_Metrics</h3>
          <div class="space-y-4 px-1">
            <div>
              <div class="flex justify-between mb-2">
                <span class="text-slate-400 font-bold uppercase text-[9px]">Throughput</span>
                <span class="text-slate-700 dark:text-slate-200 font-black">{appStore.systemMetrics().throughput.toFixed(1)} t/s</span>
              </div>
              <div class="h-2 nm-inset rounded-full overflow-hidden p-0.5">
                <div class="bg-blue-500 h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" style={{ width: `${Math.min(100, appStore.systemMetrics().throughput * 2)}%` }}></div>
              </div>
            </div>

            {appStore.transcriptionMode() === 'v3-streaming' && (
              <div class="mt-4 pt-4 border-t border-slate-200/50 dark:border-slate-800/50 space-y-4">
                <div>
                  <div class="flex justify-between mb-2">
                    <span class="text-slate-400 font-bold uppercase text-[9px]">Streaming Window</span>
                    <span class="text-blue-500 font-black">{appStore.streamingWindow().toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min="0.16"
                    max="8.0"
                    step="0.08"
                    value={appStore.streamingWindow()}
                    onInput={(e) => appStore.setStreamingWindow(parseFloat(e.currentTarget.value))}
                    class="w-full h-1 nm-flat rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div class="nm-flat rounded-xl p-3 bg-blue-500/5">
                  <div class="text-[9px] font-bold text-slate-500 uppercase mb-1">Anchor_Status</div>
                  <div class={`text-[10px] font-black ${appStore.mergeInfo().anchorValid ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {appStore.mergeInfo().anchorValid ? 'STABLE_LCS_LOCK' : 'SEARCHING_LOCK...'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
