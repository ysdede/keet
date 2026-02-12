import { Component, Show, For, createEffect } from 'solid-js';

interface ModelLoadingOverlayProps {
    isVisible: boolean;
    progress: number;
    message: string;
    file?: string;
    backend: 'webgpu' | 'wasm';
    state: 'unloaded' | 'loading' | 'ready' | 'error';
    selectedModelId: string;
    onModelSelect: (id: string) => void;
    onStart: () => void;
    onLocalLoad: (files: FileList) => void;
    onClose?: () => void;
}

export const MODELS = [
    { id: 'parakeet-tdt-0.6b-v2', name: 'Parakeet v2', desc: 'English optimized' },
    { id: 'parakeet-tdt-0.6b-v3', name: 'Parakeet v3', desc: 'Multilingual Streaming' },
];

export function getModelDisplayName(id: string): string {
    return (MODELS.find((m) => m.id === id)?.name ?? id) || 'Unknown model';
}

export const ModelLoadingOverlay: Component<ModelLoadingOverlayProps> = (props) => {
    const progressWidth = () => `${Math.max(0, Math.min(100, props.progress))}%`;
    let fileInput: HTMLInputElement | undefined;

    const handleFileChange = (e: Event) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
            props.onLocalLoad(files);
        }
    };

    const handleClose = () => props.onClose?.();

    createEffect(() => {
        if (!props.isVisible || !props.onClose) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                props.onClose?.();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    });

    return (
        <Show when={props.isVisible}>
            <div
                class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-earthy-dark-brown)]/30 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="model-overlay-title"
                onClick={(e) => e.target === e.currentTarget && handleClose()}
            >
                <input
                    type="file"
                    multiple
                    ref={fileInput}
                    class="hidden"
                    onChange={handleFileChange}
                />

                <div class="w-full max-w-lg mx-4">
                    <div class="relative nm-flat rounded-[40px] overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
                        {/* Close Button - show whenever onClose is provided so user can dismiss in any state */}
                        <Show when={props.onClose}>
                            <button
                                type="button"
                                onClick={handleClose}
                                class="absolute top-8 right-8 neu-square-btn text-[var(--color-earthy-soft-brown)] hover:text-[var(--color-earthy-coral)] transition-all z-10"
                                aria-label="Close"
                            >
                                <span class="material-symbols-outlined text-xl">close</span>
                            </button>
                        </Show>

                        {/* Header */}
                        <div class="p-10 pb-6 text-center">
                            <div class="w-20 h-20 mx-auto mb-8 rounded-[32px] nm-inset flex items-center justify-center">
                                <Show
                                    when={props.state !== 'error'}
                                    fallback={<span class="material-symbols-outlined text-[var(--color-earthy-coral)] text-4xl">warning</span>}
                                >
                                    <span class={`material-symbols-outlined text-[var(--color-earthy-muted-green)] text-4xl ${props.state === 'loading' ? 'animate-pulse' : ''}`}>
                                        {props.state === 'loading' ? 'downloading' : 'neurology'}
                                    </span>
                                </Show>
                            </div>

                            <h2 id="model-overlay-title" class="text-3xl font-extrabold text-[var(--color-earthy-dark-brown)] tracking-tight">
                                {props.state === 'unloaded' ? 'Engine Selection' :
                                    props.state === 'error' ? 'Loading Failed' : 'Model Installation'}
                            </h2>

                            <p class="text-sm text-[var(--color-earthy-soft-brown)] font-medium mt-3 px-10">
                                {props.state === 'unloaded' ? 'Select the AI engine for this transcription session.' : props.message}
                            </p>
                        </div>

                        {/* Content */}
                        <div class="px-10 pb-10">
                            <Show when={props.state === 'unloaded'}>
                                <div class="space-y-4">
                                    <div class="grid gap-4">
                                        <For each={MODELS}>
                                            {(model) => (
                                                <button
                                                    onClick={() => props.onModelSelect(model.id)}
                                                    class={`flex items-center text-left p-6 rounded-3xl transition-all ${props.selectedModelId === model.id
                                                        ? 'nm-inset text-[var(--color-earthy-muted-green)] ring-2 ring-[var(--color-earthy-muted-green)]/20'
                                                        : 'nm-flat text-[var(--color-earthy-dark-brown)] hover:shadow-neu-btn-hover'
                                                        }`}
                                                >
                                                    <div class={`w-6 h-6 rounded-full nm-inset mr-5 flex flex-none items-center justify-center ${props.selectedModelId === model.id ? 'text-[var(--color-earthy-muted-green)]' : 'text-[var(--color-earthy-sage)]'
                                                        }`}>
                                                        <Show when={props.selectedModelId === model.id}>
                                                            <div class="w-2.5 h-2.5 bg-[var(--color-earthy-muted-green)] rounded-full shadow-[0_0_8px_var(--color-earthy-muted-green)]" />
                                                        </Show>
                                                    </div>
                                                    <div>
                                                        <div class="font-bold text-lg leading-tight">{model.name}</div>
                                                        <div class="text-[10px] font-black opacity-40 uppercase tracking-widest mt-1">{model.desc}</div>
                                                    </div>
                                                </button>
                                            )}
                                        </For>

                                        <button
                                            onClick={() => fileInput?.click()}
                                            class="flex items-center text-left p-6 rounded-3xl nm-flat opacity-70 hover:opacity-100 transition-all hover:shadow-neu-btn-hover"
                                        >
                                            <div class="w-10 h-10 rounded-2xl nm-inset flex items-center justify-center mr-5">
                                                <span class="material-symbols-outlined text-[var(--color-earthy-soft-brown)] text-xl">file_open</span>
                                            </div>
                                            <div>
                                                <div class="font-bold text-lg leading-tight">Local Model</div>
                                                <div class="text-[10px] font-black opacity-40 uppercase tracking-widest mt-1">Load from disk</div>
                                            </div>
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => props.onStart()}
                                        class="w-full mt-6 py-5 bg-[var(--color-earthy-muted-green)] text-white font-extrabold rounded-3xl shadow-xl active:scale-[0.98] transition-all uppercase tracking-widest text-xs"
                                    >
                                        Initialize AI Engine
                                    </button>
                                </div>
                            </Show>

                            {/* Progress */}
                            <Show when={props.state === 'loading'}>
                                <div class="mt-4">
                                    <div class="h-4 nm-inset rounded-full overflow-hidden p-1">
                                        <div
                                            class="h-full bg-[var(--color-earthy-muted-green)] rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_var(--color-earthy-muted-green)]"
                                            style={{ width: progressWidth() }}
                                        />
                                    </div>

                                    <div class="flex justify-between items-center mt-6 px-1">
                                        <div class="flex flex-col">
                                            <span class="text-[10px] font-black text-[var(--color-earthy-soft-brown)] uppercase tracking-widest leading-none mb-1">Downloaded</span>
                                            <span class="text-[var(--color-earthy-muted-green)] font-black text-2xl">{props.progress}%</span>
                                        </div>
                                        <div class="flex flex-col text-right">
                                            <span class="text-[10px] font-black text-[var(--color-earthy-soft-brown)] uppercase tracking-widest leading-none mb-1">Active File</span>
                                            <span class="text-[var(--color-earthy-soft-brown)] font-bold text-[11px] truncate max-w-[200px]">
                                                {props.file || 'Preparing assets...'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </Show>

                            <Show when={props.state === 'error'}>
                                <div>
                                    <button
                                        onClick={() => props.onStart()}
                                        class="w-full py-5 nm-flat text-[var(--color-earthy-coral)] font-black rounded-3xl shadow-none hover:opacity-90 transition-all"
                                    >
                                        Retry Connection
                                    </button>
                                </div>
                            </Show>
                        </div>

                        {/* Footer */}
                        <div class="px-10 py-6 border-t border-[var(--color-earthy-sage)]/30 flex items-center justify-between opacity-80">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-base text-[var(--color-earthy-soft-brown)]">offline_bolt</span>
                                <span class="text-[10px] font-black text-[var(--color-earthy-soft-brown)] uppercase tracking-widest">
                                    {props.backend === 'webgpu' ? 'GPU Accelerated' : 'WASM Native'}
                                </span>
                            </div>
                            <span class="text-[10px] text-[var(--color-earthy-sage)] font-black tracking-widest">
                                PRIVACY SECURED
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    );
};


