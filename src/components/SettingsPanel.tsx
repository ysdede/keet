import { Component, For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { appStore } from '../stores/appStore';
import { getModelDisplayName, getModelRepoId, MODELS } from './ModelLoadingOverlay';
import type { AudioEngine } from '../lib/audio/types';
import { getMaxHardwareThreads } from '../utils/hardwareThreads';

const formatInterval = (ms: number) => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

const DEFAULT_MODEL_REVISIONS = ['main'];
const MODEL_REVISIONS_CACHE = new Map<string, string[]>();
const MODEL_FILES_CACHE = new Map<string, string[]>();
const QUANTIZATION_ORDER: Array<'fp16' | 'int8' | 'fp32'> = ['fp16', 'int8', 'fp32'];

const formatRepoPath = (repoId: string): string =>
  repoId
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

const fetchModelRevisions = async (repoId: string | null): Promise<string[]> => {
  if (!repoId) return DEFAULT_MODEL_REVISIONS;
  const cached = MODEL_REVISIONS_CACHE.get(repoId);
  if (cached) return cached;

  try {
    const repoPath = formatRepoPath(repoId);
    const response = await fetch(`https://huggingface.co/api/models/${repoPath}/refs`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const branches = Array.isArray(payload?.branches)
      ? payload.branches.map((branch: { name?: string }) => branch?.name).filter(Boolean)
      : [];
    const revisions = branches.length > 0 ? branches : DEFAULT_MODEL_REVISIONS;
    MODEL_REVISIONS_CACHE.set(repoId, revisions);
    return revisions;
  } catch (error) {
    console.warn(`[SettingsPanel] Failed to fetch revisions for ${repoId}; using defaults`, error);
    return DEFAULT_MODEL_REVISIONS;
  }
};

const fetchModelFiles = async (repoId: string | null, revision: string): Promise<string[]> => {
  if (!repoId) return [];
  const cacheKey = `${repoId}@${revision}`;
  const cached = MODEL_FILES_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const repoPath = formatRepoPath(repoId);
    const response = await fetch(`https://huggingface.co/api/models/${repoPath}/tree/${encodeURIComponent(revision)}?recursive=1`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const files = Array.isArray(payload)
      ? payload
        .filter((entry: { type?: string; path?: string }) => entry?.type === 'file' && typeof entry?.path === 'string')
        .map((entry: { path: string }) => entry.path)
      : [];
    MODEL_FILES_CACHE.set(cacheKey, files);
    return files;
  } catch (error) {
    console.warn(`[SettingsPanel] Failed to fetch files for ${repoId}@${revision}`, error);
    return [];
  }
};

const getAvailableQuantModes = (
  files: string[],
  baseName: 'encoder-model' | 'decoder_joint-model',
): Array<'int8' | 'fp32' | 'fp16'> => {
  const existing = new Set(files);
  const options = QUANTIZATION_ORDER.filter((quant) => {
    if (quant === 'fp32') return existing.has(`${baseName}.onnx`);
    if (quant === 'fp16') return existing.has(`${baseName}.fp16.onnx`);
    return existing.has(`${baseName}.int8.onnx`);
  });
  return options.length > 0 ? options : ['fp32'];
};

const pickPreferredQuant = (
  options: Array<'int8' | 'fp32' | 'fp16'>,
  backendMode: 'webgpu-hybrid' | 'wasm',
): 'int8' | 'fp32' | 'fp16' => {
  const preferred = backendMode.startsWith('webgpu')
    ? ['fp16', 'fp32', 'int8']
    : ['int8', 'fp32', 'fp16'];
  return preferred.find((quant) => options.includes(quant as 'int8' | 'fp32' | 'fp16')) as 'int8' | 'fp32' | 'fp16'
    || options[0]
    || 'fp32';
};

/** Visible section preset for the embeddable settings content. */
export type SettingsPanelSection = 'full' | 'audio' | 'model';

export interface SettingsContentProps {
  /** When 'audio' or 'model', only that section is shown (e.g. hover on mic or load button). */
  section?: SettingsPanelSection;
  /** Closes the parent surface that hosts this settings content. */
  onClose: () => void;
  /** Triggers model loading for the selected model ID. */
  onLoadModel: () => void;
  /** Optional callback to load local model files. */
  onLocalLoad?: (files: FileList) => void;
  /** Opens the debug/diagnostics panel. */
  onOpenDebug: () => void;
  /** Called when audio input device selection changes. */
  onDeviceSelect?: (id: string) => void;
  /** Audio engine used to apply live config updates. */
  audioEngine?: AudioEngine | null;
  /** When true, panel expands upward (bar in lower half); content order is reversed so ASR model stays adjacent to the bar. */
  expandUp?: () => boolean;
}

/** Embeddable settings form (e.g. inside floating bar expansion). */
export const SettingsContent: Component<SettingsContentProps> = (props) => {
  const isV4 = () => appStore.transcriptionMode() === 'v4-utterance';
  const isV3 = () => appStore.transcriptionMode() === 'v3-streaming';
  const maxWasmThreads = () => getMaxHardwareThreads();
  const [modelRevisions, setModelRevisions] = createSignal<string[]>(DEFAULT_MODEL_REVISIONS);
  const [encoderQuantOptions, setEncoderQuantOptions] = createSignal<Array<'int8' | 'fp32' | 'fp16'>>(['fp16', 'int8', 'fp32']);
  const [decoderQuantOptions, setDecoderQuantOptions] = createSignal<Array<'int8' | 'fp32' | 'fp16'>>(['fp16', 'int8', 'fp32']);

  const expandUp = () => props.expandUp?.() ?? false;
  const section = () => props.section ?? 'full';
  const showAsr = () => section() === 'full' || section() === 'model';
  const showAudio = () => section() === 'full' || section() === 'audio';
  const showSliders = () => section() === 'full';
  const showDebug = () => section() === 'full';

  createEffect(() => {
    const selectedModelId = appStore.selectedModelId();
    const revision = appStore.modelRevision() || 'main';
    const repoId = getModelRepoId(selectedModelId);
    let cancelled = false;

    void (async () => {
      const [revisions, files] = await Promise.all([
        fetchModelRevisions(repoId),
        fetchModelFiles(repoId, revision),
      ]);
      if (cancelled) return;
      setModelRevisions(revisions);
      const currentRevision = appStore.modelRevision();
      if (!revisions.includes(currentRevision)) {
        appStore.setModelRevision(revisions[0] || 'main');
      }

      const encOptions = getAvailableQuantModes(files, 'encoder-model');
      const decOptions = getAvailableQuantModes(files, 'decoder_joint-model');
      const backendMode = appStore.modelBackendMode();
      setEncoderQuantOptions(encOptions);
      setDecoderQuantOptions(decOptions);
      if (!encOptions.includes(appStore.encoderQuant())) {
        appStore.setEncoderQuant(pickPreferredQuant(encOptions, backendMode));
      }
      if (!decOptions.includes(appStore.decoderQuant())) {
        appStore.setDecoderQuant(pickPreferredQuant(decOptions, backendMode));
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <div class="flex flex-col min-h-0">
      <div
        class="flex flex-col flex-1 min-h-0 overflow-y-auto p-3 gap-4 custom-scrollbar"
        classList={{ 'flex-col-reverse': expandUp() }}
      >
        <Show when={showAsr()}>
          <section class="space-y-2">
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">ASR model</h3>
            <div class="flex items-center gap-2 flex-wrap">
            <select
              class="flex-1 min-w-0 text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
              value={appStore.selectedModelId()}
              onInput={(e) => appStore.setSelectedModelId((e.target as HTMLSelectElement).value)}
              disabled={appStore.modelState() === 'loading'}
            >
              <For each={MODELS}>
                {(m) => <option value={m.id}>{m.name}</option>}
              </For>
            </select>
            <button
              type="button"
              onClick={props.onLoadModel}
              disabled={appStore.modelState() === 'loading'}
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-sage)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <span class="material-symbols-outlined text-lg">power_settings_new</span>
              {appStore.modelState() === 'ready' ? 'Reload' : appStore.modelState() === 'loading' ? '...' : 'Load'}
            </button>
            <Show when={props.onLocalLoad}>
              <label class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-earthy-soft-brown)] hover:bg-[var(--color-earthy-sage)]/20 transition-colors cursor-pointer shrink-0">
                <span class="material-symbols-outlined text-lg">folder_open</span>
                Load from file
                <input
                  type="file"
                  multiple
                  class="hidden"
                  accept=".onnx,.bin"
                  onChange={(e) => {
                    const files = e.currentTarget.files;
                    if (files && files.length > 0) props.onLocalLoad?.(files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </Show>
          </div>
          <p class="text-xs text-[var(--color-earthy-soft-brown)]">
            {appStore.modelState() === 'ready' ? getModelDisplayName(appStore.selectedModelId()) : appStore.modelState()}
          </p>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
            <div class="space-y-1 col-span-2">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Model branch</span>
              <div class="flex items-center gap-2">
                <select
                  class="w-48 text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
                  value={appStore.modelRevision()}
                  onInput={(e) => appStore.setModelRevision((e.target as HTMLSelectElement).value)}
                  disabled={appStore.modelState() === 'loading'}
                >
                  <For each={modelRevisions()}>
                    {(revision) => <option value={revision}>{revision}</option>}
                  </For>
                </select>
                <input
                  type="text"
                  class="flex-1 text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
                  value={appStore.modelRevision()}
                  onInput={(e) => appStore.setModelRevision((e.target as HTMLInputElement).value)}
                  disabled={appStore.modelState() === 'loading'}
                  placeholder="custom branch or tag"
                />
              </div>
            </div>
            <div class="space-y-1">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Backend</span>
              <select
                class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
                value={appStore.modelBackendMode()}
                onInput={(e) => appStore.setModelBackendMode((e.target as HTMLSelectElement).value as 'webgpu-hybrid' | 'wasm')}
                disabled={appStore.modelState() === 'loading'}
              >
                <option value="webgpu-hybrid">WebGPU</option>
                <option value="wasm">WASM</option>
              </select>
            </div>
            <div class="space-y-1">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Stride</span>
              <input
                type="number"
                min="1"
                max="4"
                step="1"
                value={appStore.frameStride()}
                onInput={(e) => {
                  const next = Number((e.target as HTMLInputElement).value);
                  if (Number.isFinite(next)) appStore.setFrameStride(Math.max(1, Math.min(4, Math.round(next))));
                }}
                class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Encoder</span>
              <select
                class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
                value={appStore.encoderQuant()}
                onInput={(e) => appStore.setEncoderQuant((e.target as HTMLSelectElement).value as 'int8' | 'fp32' | 'fp16')}
                disabled={appStore.modelState() === 'loading'}
              >
                <For each={encoderQuantOptions()}>
                  {(quant) => <option value={quant}>{quant}</option>}
                </For>
              </select>
            </div>
            <div class="space-y-1">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Decoder</span>
              <select
                class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
                value={appStore.decoderQuant()}
                onInput={(e) => appStore.setDecoderQuant((e.target as HTMLSelectElement).value as 'int8' | 'fp32' | 'fp16')}
                disabled={appStore.modelState() === 'loading'}
              >
                <For each={decoderQuantOptions()}>
                  {(quant) => <option value={quant}>{quant}</option>}
                </For>
              </select>
            </div>
          </div>
          <Show when={appStore.modelState() === 'loading'}>
            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span>{appStore.modelMessage()}</span>
                <span class="font-mono text-[var(--color-earthy-muted-green)]">{Math.round(appStore.modelProgress())}%</span>
              </div>
              <div class="h-1.5 rounded-full overflow-hidden bg-[var(--color-earthy-sage)]/20">
                <div
                  class="h-full bg-[var(--color-earthy-muted-green)] rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, appStore.modelProgress()))}%` }}
                />
              </div>
            </div>
          </Show>
          </section>
        </Show>

        <Show when={showAudio()}>
          <section class="space-y-2">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Audio input</h3>
          <select
            class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
            value={appStore.selectedDeviceId()}
            onInput={(e) => {
              const id = (e.target as HTMLSelectElement).value;
              appStore.setSelectedDeviceId(id);
              props.onDeviceSelect?.(id);
            }}
          >
            <For each={appStore.availableDevices()}>
              {(device) => (
                <option value={device.deviceId}>
                  {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                </option>
              )}
            </For>
          </select>
          </section>
        </Show>

        <Show when={showSliders()}>
          <section class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="space-y-1.5 min-w-0">
            <div class="flex justify-between items-center gap-2">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">WASM threads</span>
              <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{appStore.wasmThreads()} / {maxWasmThreads()}</span>
            </div>
            <input
              type="range"
              min="1"
              max={maxWasmThreads()}
              step="1"
              value={Math.min(appStore.wasmThreads(), maxWasmThreads())}
              onInput={(e) => {
                const next = parseInt(e.currentTarget.value, 10);
                appStore.setWasmThreads(Math.max(1, Math.min(maxWasmThreads(), next)));
              }}
              class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
            />
            <div class="text-[9px] text-[var(--color-earthy-soft-brown)]">Applied on next model load/reload.</div>
          </div>

          <div class="space-y-1.5 min-w-0">
            <div class="flex justify-between items-center gap-2">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Energy threshold</span>
              <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{(appStore.energyThreshold() * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range" min="0.005" max="0.3" step="0.005"
              value={appStore.energyThreshold()}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                appStore.setEnergyThreshold(val);
                props.audioEngine?.updateConfig({ energyThreshold: val });
              }}
              class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
            />
          </div>

          <Show when={isV4()}>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">VAD threshold</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{(appStore.sileroThreshold() * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min="0.1" max="0.9" step="0.05"
                value={appStore.sileroThreshold()}
                onInput={(e) => appStore.setSileroThreshold(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Tick interval</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{formatInterval(appStore.v4InferenceIntervalMs())}</span>
              </div>
              <input
                type="range" min="160" max="8000" step="80"
                value={appStore.v4InferenceIntervalMs()}
                onInput={(e) => appStore.setV4InferenceIntervalMs(parseInt(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
              <div class="flex justify-between text-[9px] text-[var(--color-earthy-soft-brown)]">
                <span>320ms</span>
                <span>8.0s</span>
              </div>
            </div>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Silence flush</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{appStore.v4SilenceFlushSec().toFixed(1)}s</span>
              </div>
              <input
                type="range" min="0.3" max="5.0" step="0.1"
                value={appStore.v4SilenceFlushSec()}
                onInput={(e) => appStore.setV4SilenceFlushSec(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
          </Show>

          <Show when={isV3()}>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Window</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{appStore.streamingWindow().toFixed(1)}s</span>
              </div>
              <input
                type="range" min="2.0" max="15.0" step="0.5"
                value={appStore.streamingWindow()}
                onInput={(e) => appStore.setStreamingWindow(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
          </Show>
          </section>
        </Show>

        <Show when={showDebug()}>
          <div class="pt-2">
            <button
              type="button"
              onClick={() => {
                props.onOpenDebug();
                props.onClose();
              }}
              class="flex items-center gap-2 px-0 py-2 text-sm font-medium text-[var(--color-earthy-muted-green)] hover:opacity-80 transition-opacity w-full"
            >
              <span class="material-symbols-outlined text-lg">bug_report</span>
              Open Debug panel
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
