import { Component } from 'solid-js';

/** Floating privacy badge that explains on-device transcription guarantees. */
export const PrivacyBadge: Component = () => {
    return (
        <div class="fixed bottom-16 right-8 z-30 group">
            <div class="nm-flat rounded-full px-5 py-2.5 flex items-center gap-2 cursor-help transition-all hover:scale-105 active:scale-95 group-hover:bg-green-500/5">
                <span class="material-icons-round text-green-500 text-sm shadow-[0_0_8px_rgba(34,197,94,0.4)]">shield</span>
                <span class="text-[10px] font-black text-green-600 dark:text-green-400 tracking-widest uppercase">Private_Secure</span>
            </div>

            <div class="absolute bottom-full right-0 mb-6 w-64 p-5 nm-flat rounded-[28px] opacity-0 group-hover:opacity-100 pointer-events-none transition-all transform translate-y-4 group-hover:translate-y-0">
                <h4 class="font-black text-xs mb-2 tracking-tight uppercase text-slate-700 dark:text-slate-200">Local_Vault_Secure</h4>
                <p class="text-[11px] text-slate-500 leading-relaxed font-medium">
                    Your audio never leaves this device. All transcription and AI processing happens locally in your browser's WebGPU sandbox.
                </p>
            </div>
        </div>
    );
};
