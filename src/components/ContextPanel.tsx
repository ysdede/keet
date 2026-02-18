import { Component, For, Show, createEffect, onCleanup } from 'solid-js';
import { appStore } from '../stores/appStore';
import { getModelDisplayName, MODELS } from './ModelLoadingOverlay';

interface ContextPanelProps {
  /** Controls dialog visibility. */
  isOpen: boolean;
  /** Closes the dialog and restores focus to the main UI flow. */
  onClose: () => void;
  /** Starts model loading for the selected ASR model. */
  onLoadModel: () => void;
  /** Opens the developer/debug panel. */
  onOpenDebug: () => void;
  /** Called when the selected input device changes. */
  onDeviceSelect?: (id: string) => void;
}

/** Modal panel for quick access to model, audio input, backend, and debug actions. */
export const ContextPanel: Component<ContextPanelProps> = (props) => {
  createEffect(() => {
    if (!props.isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-earthy-dark-brown)]/30 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Context and settings"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div
          class="w-full max-w-md mx-4 bg-[var(--color-earthy-bg)] rounded-2xl border border-[var(--color-earthy-sage)] shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="px-6 py-4 border-b border-[var(--color-earthy-sage)]/30 flex items-center justify-between">
            <h2 class="text-lg font-semibold tracking-tight text-[var(--color-earthy-dark-brown)]">Context</h2>
            <button
              type="button"
              onClick={props.onClose}
              class="p-2 rounded-full text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-sage)]/30 transition-colors"
              aria-label="Close"
            >
              <span class="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          <div class="p-6 space-y-6">
            <section>
              <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-3">Model</h3>
              <div class="flex flex-col gap-2">
                <select
                  class="w-full text-sm bg-white border border-[var(--color-earthy-sage)] rounded-xl px-3 py-2 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:ring-2 focus:ring-[var(--color-earthy-coral)]/30"
                  value={appStore.selectedModelId()}
                  onInput={(e) => appStore.setSelectedModelId((e.target as HTMLSelectElement).value)}
                  disabled={appStore.modelState() === 'loading'}
                >
                  <For each={MODELS}>
                    {(m) => <option value={m.id}>{m.name}</option>}
                  </For>
                </select>
                <p class="text-xs text-[var(--color-earthy-soft-brown)]">
                  {appStore.modelState() === 'ready' ? getModelDisplayName(appStore.selectedModelId()) : appStore.modelState()}
                </p>
                <button
                  type="button"
                  onClick={props.onLoadModel}
                  disabled={appStore.modelState() === 'ready' || appStore.modelState() === 'loading'}
                  class="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--color-earthy-sage)] text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-muted-green)] hover:text-white transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span class="material-symbols-outlined text-lg">power_settings_new</span>
                  {appStore.modelState() === 'ready' ? 'Model loaded' : appStore.modelState() === 'loading' ? 'Loading...' : 'Load model'}
                </button>
              </div>
            </section>

            <section>
              <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-3">Audio input</h3>
              <select
                class="w-full text-sm bg-white border border-[var(--color-earthy-sage)] rounded-xl px-3 py-2 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:ring-2 focus:ring-[var(--color-earthy-coral)]/30"
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

            <section>
              <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-2">Backend</h3>
              <p class="text-sm text-[var(--color-earthy-dark-brown)] font-medium">{appStore.backend().toUpperCase()}</p>
            </section>

            <div class="pt-2 border-t border-[var(--color-earthy-sage)]/30 flex items-center justify-between">
              <span class="text-xs text-[var(--color-earthy-soft-brown)]">Developer</span>
              <button
                type="button"
                onClick={() => {
                  props.onOpenDebug();
                  props.onClose();
                }}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-sage)]/30 transition-colors"
              >
                <span class="material-symbols-outlined text-base">bug_report</span>
                Open Debug panel
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
