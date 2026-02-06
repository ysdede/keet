import { Component, createMemo, For, Show } from 'solid-js';
import { appStore } from '../stores/appStore';
import type { AudioEngine } from '../lib/audio/types';

interface DebugPanelProps {
  audioEngine?: AudioEngine;
}

export const DebugPanel: Component<DebugPanelProps> = (props) => {
  const isRecording = () => appStore.recordingState() === 'recording';

  // Color code for RTF
  const rtfColor = createMemo(() => {
    const val = appStore.rtf();
    if (val === 0) return 'text-slate-500';
    if (val < 0.5) return 'text-green-500';
    if (val < 0.9) return 'text-yellow-500';
    return 'text-red-500 font-bold';
  });

  return (
    <div class="h-64 bg-slate-900 border-t border-slate-700 text-[11px] font-mono text-slate-300 flex overflow-hidden shrink-0 transition-colors duration-300 selection:bg-blue-500 selection:text-white">

      {/* 1. System & Performance Column */}
      <div class="w-64 border-r border-slate-800 flex flex-col p-3 gap-3 bg-slate-950/30">
        <div class="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
          <span class="text-slate-500 font-bold tracking-tighter uppercase">SYS_MONITOR</span>
          <div class="flex items-center gap-2">
            <div class={`w-2 h-2 rounded-full ${isRecording() ? 'bg-red-500 animate-pulse shadow-[0_0_5px_#ef4444]' : 'bg-slate-700'}`} />
            <span class="text-[9px] text-slate-600 font-bold">{appStore.backend().toUpperCase()}</span>
          </div>
        </div>

        <div class="space-y-1.5 px-0.5">
          <div class="flex justify-between">
            <span class="text-slate-500">ENGINE_MODE</span>
            <span class="text-blue-400 font-bold underline decoration-blue-900/50">{appStore.transcriptionMode()}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">RTF (SPEED)</span>
            <span class={rtfColor()}>{appStore.rtf().toFixed(3)}x</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">INF_LATENCY</span>
            <span class="text-blue-400">{appStore.inferenceLatency().toFixed(0)}ms</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">BUF_LATENCY</span>
            <span class="text-blue-400">{appStore.bufferMetrics().latencyMs.toFixed(0)}ms</span>
          </div>
          <div class="flex flex-col gap-1 pt-1">
            <div class="flex justify-between">
              <span class="text-slate-500 text-[9px]">BUFFER_FILL</span>
              <span class="text-slate-500 text-[9px]">{(appStore.bufferMetrics().fillRatio * 100).toFixed(1)}%</span>
            </div>
            <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden border border-slate-700/30">
              <div
                class="bg-blue-600 h-full transition-all duration-300"
                style={{ width: `${(appStore.bufferMetrics().fillRatio * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        </div>

        <div class="mt-auto pt-2 grid grid-cols-2 gap-2">
          <div class="p-1 px-2 rounded bg-slate-900 border border-slate-800">
            <div class="text-[8px] text-slate-600 font-bold uppercase">Throughput</div>
            <div class="text-[10px] text-blue-400">{appStore.systemMetrics().throughput.toFixed(1)} w/s</div>
          </div>
          <div class="p-1 px-2 rounded bg-slate-900 border border-slate-800">
            <div class="text-[8px] text-slate-600 font-bold uppercase">Confidence</div>
            <div class="text-[10px] text-blue-400">{(appStore.systemMetrics().modelConfidence * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* 2. Streaming Buffer & LCS Context */}
      <div class="flex-1 border-r border-slate-800 flex flex-col min-w-0">
        <div class="p-2 border-b border-slate-800 bg-slate-950/20 flex items-center justify-between px-3">
          <span class="text-slate-500 font-bold tracking-tighter uppercase">V3_TELEMETRY_STREAM</span>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5">
              <div class={`w-1.5 h-1.5 rounded-full ${appStore.mergeInfo().anchorValid ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : 'bg-slate-700'}`} />
              <span class="text-[9px] text-slate-500">LCS_LOCK</span>
            </div>
            <span class="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400 border border-slate-700 font-bold">MATCH: {appStore.mergeInfo().lcsLength}</span>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-3 font-mono scrollbar-thin scrollbar-thumb-slate-800">
          <div class="space-y-1">
            <div class="text-slate-600 text-[9px] font-bold uppercase flex items-center gap-2">
              <span>Anchor_Tokens</span>
              <div class="h-px flex-1 bg-slate-800/50"></div>
            </div>
            <div class="flex flex-wrap gap-1.5 min-h-[40px] p-2 bg-slate-950/40 rounded border border-slate-800/50">
              <Show when={appStore.mergeInfo().anchorTokens?.length} fallback={<span class="text-slate-700 italic py-2">Waiting for stable synchronization...</span>}>
                <For each={appStore.mergeInfo().anchorTokens}>
                  {(token) => (
                    <span class="px-1.5 py-0.5 bg-green-900/20 text-green-400 border border-green-800/40 rounded-sm leading-none text-[10px]">
                      {token}
                    </span>
                  )}
                </For>
              </Show>
            </div>
          </div>

          <div class="space-y-1">
            <div class="text-slate-600 text-[9px] font-bold uppercase flex items-center gap-2">
              <span>Transition_Cache</span>
              <div class="h-px flex-1 bg-slate-800/50"></div>
            </div>
            <div class="flex flex-wrap gap-1 p-1">
              <For each={appStore.debugTokens().slice(-16)}>
                {(token) => (
                  <span
                    class="px-1.5 py-0.5 rounded-sm border border-slate-800/50 text-[10px] transition-colors"
                    style={{
                      "background-color": `rgba(59, 130, 246, ${Math.min(0.2, token.confidence)})`,
                      "color": token.confidence > 0.8 ? '#fff' : '#64748b'
                    }}
                    title={`Conf: ${(token.confidence * 100).toFixed(1)}%`}
                  >
                    {token.text}
                  </span>
                )}
              </For>
              <Show when={appStore.pendingText()}>
                <span class="px-1.5 py-0.5 text-blue-500 italic decoration-dotted underline underline-offset-2">
                  {appStore.pendingText()}
                </span>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Signal Profile & VAD Dashboard */}
      <div class="w-56 p-3 flex flex-col gap-4 bg-slate-950/30">
        <div class="text-slate-500 font-bold tracking-tighter uppercase border-b border-slate-800 pb-1 mb-1">SIGNAL_VAD</div>

        <div class="space-y-4">
          {/* Energy Meter Stack */}
          <div class="space-y-1">
            <div class="flex justify-between text-[9px] text-slate-500 font-bold uppercase">
              <span>RMS_ENERGY</span>
              <span class={appStore.isSpeechDetected() ? 'text-orange-500' : 'text-slate-400'}>
                {(appStore.audioLevel() * 100).toFixed(2)}%
              </span>
            </div>
            <div class="h-4 bg-slate-950 rounded border border-slate-800 p-0.5 relative">
              {/* Threshold indicator */}
              <div
                class="absolute h-full w-0.5 bg-yellow-500/50 z-10"
                style={{ left: `${(appStore.energyThreshold() * 100).toFixed(2)}%` }}
              />
              <div
                class={`h-full transition-all duration-75 rounded-sm ${appStore.isSpeechDetected() ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-blue-600/50'}`}
                style={{ width: `${Math.min(100, appStore.audioLevel() * 100)}%` }}
              />
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="flex justify-between text-[9px] text-slate-500 font-bold uppercase">
              <span>VAD_GATE</span>
              <span class="text-blue-500">{(appStore.energyThreshold() * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.005"
              max="0.4"
              step="0.005"
              value={appStore.energyThreshold()}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                appStore.setEnergyThreshold(val);
                props.audioEngine?.updateConfig({ energyThreshold: val });
              }}
              class="w-full accent-blue-600 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer"
            />
          </div>

          <div class="space-y-1.5">
            <div class="flex justify-between text-[9px] text-slate-500 font-bold uppercase">
              <span>TRIGGER_INT</span>
              <span class="text-blue-500">{appStore.triggerInterval().toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="5.0"
              step="0.1"
              value={appStore.triggerInterval()}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                appStore.setTriggerInterval(val);
              }}
              class="w-full accent-blue-600 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer"
            />
          </div>

          <div class="space-y-1.5">
            <div class="flex justify-between text-[9px] text-slate-500 font-bold uppercase">
              <span>WINDOW_SIZE</span>
              <span class="text-blue-500">{appStore.streamingWindow().toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="2.0"
              max="15.0"
              step="0.5"
              value={appStore.streamingWindow()}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                appStore.setStreamingWindow(val);
              }}
              class="w-full accent-blue-600 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer"
            />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="p-1 px-2 border border-slate-800 rounded bg-slate-950">
              <div class="text-[8px] text-slate-600 font-bold uppercase">VAD_STATE</div>
              <div class={`text-[10px] font-bold ${appStore.isSpeechDetected() ? 'text-orange-400 animate-pulse' : 'text-slate-600'}`}>
                {appStore.isSpeechDetected() ? '>>> SPEECH' : 'SILENCE'}
              </div>
            </div>
            <div class="p-1 px-2 border border-slate-800 rounded bg-slate-950">
              <div class="text-[8px] text-slate-600 font-bold uppercase">SEG_COUNT</div>
              <div class="text-[10px] text-blue-400 font-bold">{appStore.mergeInfo().chunkCount}</div>
            </div>
          </div>
        </div>

        <div class="mt-auto space-y-1 p-2 rounded bg-slate-950/50 border border-slate-800/50">
          <div class="text-slate-600 text-[8px] font-bold uppercase">Streaming_Config</div>
          <div class="flex justify-between text-[10px]">
            <span class="text-slate-500">WIN: <b class="text-blue-500">{appStore.streamingWindow()}s</b></span>
            <span class="text-slate-500">OVR: <b class="text-blue-500">{appStore.streamingOverlap()}s</b></span>
          </div>
        </div>
      </div>
    </div>
  );
};
