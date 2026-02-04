import { Component, Show, For } from 'solid-js';

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

const MODELS = [
    { id: 'parakeet-tdt-0.6b-v2', name: 'Parakeet v2', desc: 'English Only' },
    { id: 'parakeet-tdt-0.6b-v3', name: 'Parakeet v3', desc: 'Multilingual' },
];

export const ModelLoadingOverlay: Component<ModelLoadingOverlayProps> = (props) => {
    const progressWidth = () => `${Math.max(0, Math.min(100, props.progress))}%`;
    let fileInput: HTMLInputElement | undefined;

    const handleFileChange = (e: Event) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
            props.onLocalLoad(files);
        }
    };

    return (
        <Show when={props.isVisible}>
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nm-bg)]/60 backdrop-blur-sm dark:bg-[var(--nm-bg-dark)]/60">
                {/* Hidden File Input */}
                <input
                    type="file"
                    multiple
                    ref={fileInput}
                    class="hidden"
                    onChange={handleFileChange}
                />

                <div class="w-full max-w-lg mx-4">
                    {/* Neumorphic Card */}
                    <div class="relative nm-flat rounded-[40px] overflow-hidden transition-all duration-300 animate-in fade-in duration-500">
                        {/* Close Button */}
                        <Show when={props.onClose}>
                            <button
                                onClick={() => props.onClose?.()}
                                class="absolute top-6 right-6 w-10 h-10 rounded-xl nm-button flex items-center justify-center text-slate-400 hover:text-red-500 transition-all z-10"
                            >
                                <span class="material-icons-round text-base">close</span>
                            </button>
                        </Show>

                        {/* Header Section */}
                        <div class="p-10 pb-6 text-center">
                            <div class="w-24 h-24 mx-auto mb-8 rounded-[32px] nm-inset flex items-center justify-center">
                                <Show
                                    when={props.state !== 'error'}
                                    fallback={<span class="material-icons-round text-red-500 text-5xl">error_outline</span>}
                                >
                                    <span class={`material-icons-round text-blue-500 text-5xl ${props.state === 'loading' ? 'animate-pulse' : ''}`}>
                                        {props.state === 'loading' ? 'auto_awesome' : 'psychology'}
                                    </span>
                                </Show>
                            </div>

                            <h2 class="text-3xl font-bold text-slate-800 dark:text-slate-100">
                                {props.state === 'unloaded' ? 'Select AI Model' :
                                    props.state === 'error' ? 'Loading Failed' : 'Assembling Brain'}
                            </h2>

                            <p class="text-sm text-slate-400 font-medium mt-3 px-10">
                                {props.state === 'unloaded' ? 'Choose the engine for your transcription session.' : props.message}
                            </p>
                        </div>

                        {/* Content Section */}
                        <div class="px-10 pb-10">
                            {/* Selection Mode */}
                            <Show when={props.state === 'unloaded'}>
                                <div class="space-y-4">
                                    <div class="grid gap-4">
                                        <For each={MODELS}>
                                            {(model) => (
                                                <button
                                                    onClick={() => props.onModelSelect(model.id)}
                                                    class={`flex items-center text-left p-5 rounded-3xl transition-all ${props.selectedModelId === model.id
                                                            ? 'nm-inset text-blue-500 border-2 border-blue-500/20'
                                                            : 'nm-button text-slate-600'
                                                        }`}
                                                >
                                                    <div class={`w-6 h-6 rounded-full nm-inset mr-5 flex flex-none items-center justify-center ${props.selectedModelId === model.id ? 'text-blue-500' : 'text-slate-300'
                                                        }`}>
                                                        <Show when={props.selectedModelId === model.id}>
                                                            <div class="w-2.5 h-2.5 bg-blue-500 rounded-full" />
                                                        </Show>
                                                    </div>
                                                    <div>
                                                        <div class="font-bold text-lg leading-tight">{model.name}</div>
                                                        <div class="text-xs font-semibold opacity-60 uppercase tracking-widest mt-1">{model.desc}</div>
                                                    </div>
                                                </button>
                                            )}
                                        </For>

                                        {/* Local Disk Option */}
                                        <button
                                            onClick={() => fileInput?.click()}
                                            class="flex items-center text-left p-5 rounded-3xl nm-button opacity-70 hover:opacity-100 transition-all group"
                                        >
                                            <div class="w-10 h-10 rounded-2xl nm-inset flex items-center justify-center mr-5">
                                                <span class="material-icons-round text-slate-400 text-xl">folder_open</span>
                                            </div>
                                            <div>
                                                <div class="font-bold text-lg leading-tight">Load from Disk</div>
                                                <div class="text-xs font-semibold opacity-60 uppercase tracking-widest mt-1">Sideload local files</div>
                                            </div>
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => props.onStart()}
                                        class="w-full mt-6 py-5 nm-button text-blue-600 font-black rounded-3xl active:nm-inset transition-all uppercase tracking-widest text-sm"
                                    >
                                        Initialize Engine
                                    </button>
                                </div>
                            </Show>

                            {/* Progress Mode */}
                            <Show when={props.state === 'loading'}>
                                <div class="mt-4">
                                    <div class="h-6 nm-inset rounded-full overflow-hidden p-1.5">
                                        <div
                                            class="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(59,130,246,0.6)]"
                                            style={{ width: progressWidth() }}
                                        />
                                    </div>

                                    <div class="flex justify-between items-center mt-6">
                                        <div class="flex flex-col">
                                            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Status</span>
                                            <span class="text-blue-500 font-black text-2xl">{props.progress}%</span>
                                        </div>
                                        <div class="flex flex-col text-right">
                                            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Active Asset</span>
                                            <span class="text-slate-500 font-bold text-xs truncate max-w-[200px]">
                                                {props.file || `${MODELS.find(m => m.id === props.selectedModelId)?.name || 'Model'} assets`}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </Show>

                            {/* Error Mode */}
                            <Show when={props.state === 'error'}>
                                <div>
                                    <button
                                        onClick={() => props.onStart()}
                                        class="w-full py-5 nm-button text-red-500 font-black rounded-3xl shadow-none"
                                    >
                                        RETRY LOADING
                                    </button>
                                </div>
                            </Show>
                        </div>

                        {/* Neumorphic Footer */}
                        <div class="px-10 py-6 nm-inset bg-transparent flex items-center justify-between rounded-t-[40px] opacity-80">
                            <div class="flex items-center gap-2">
                                <span class="material-icons-round text-sm text-slate-400">memory</span>
                                <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    {props.backend === 'webgpu' ? 'WebGPU Acceleration' : 'WASM COMPATIBILITY'}
                                </span>
                            </div>
                            <span class="text-[10px] text-slate-300 font-black tracking-widest">
                                BONCUKCORE V2
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    );
};

