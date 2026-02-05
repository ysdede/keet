import { Component, Show } from 'solid-js';
import { appStore } from '../stores/appStore';

export const StatusBar: Component = () => {
    const modelStatusText = () => {
        switch (appStore.modelState()) {
            case 'unloaded': return 'Model not loaded';
            case 'loading': return appStore.modelMessage() || `Loading... ${appStore.modelProgress()}%`;
            case 'ready': return 'Ready';
            case 'error': return 'Error';
            default: return '';
        }
    };

    const statusDotClass = () => {
        switch (appStore.modelState()) {
            case 'ready': return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
            case 'loading': return 'bg-yellow-500 animate-pulse';
            case 'error': return 'bg-red-500';
            default: return 'bg-gray-400';
        }
    };

    return (
        <div class="flex-none h-10 nm-inset mx-4 mb-4 rounded-2xl px-6 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest transition-all duration-300">
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class={`w-2 h-2 rounded-full ${statusDotClass()}`}></div>
                    <span class="text-slate-600 dark:text-slate-300">{modelStatusText()}</span>
                </div>

                <div class="flex items-center gap-2 opacity-60">
                    <span class="material-icons-round text-sm">memory</span>
                    <span>BACKEND: <span class="text-blue-500 font-black">{appStore.backend().toUpperCase()}</span></span>
                </div>
            </div>

            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity cursor-default">
                    <span class="text-[8px] font-black tracking-[0.2em]">BUILD: 20250828.VAD_REFIX</span>
                </div>
                <Show when={appStore.isOfflineReady()}>
                    <div class="flex items-center gap-1.5 text-indigo-500 font-black">
                        <span class="material-icons-round text-sm">offline_bolt</span>
                        <span>100% On-Device</span>
                    </div>
                </Show>
                <div class="flex items-center gap-1.5 opacity-80">
                    <div class={`w-2 h-2 rounded-full ${appStore.isOnline() ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`}></div>
                    <span>{appStore.isOnline() ? 'SYNC: CONNECTED' : 'SYNC: OFFLINE'}</span>
                </div>
            </div>
        </div>
    );
};
