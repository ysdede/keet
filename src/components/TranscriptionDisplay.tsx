import { Component, Show, createMemo, onMount, onCleanup } from 'solid-js';

export interface TranscriptionDisplayProps {
    confirmedText: string;
    pendingText: string;
    isRecording: boolean;
    lcsLength?: number;
    anchorValid?: boolean;
    showConfidence?: boolean;
    placeholder?: string;
    class?: string;
}

export const TranscriptionDisplay: Component<TranscriptionDisplayProps> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    let scrollScheduled = false;

    const scrollToBottom = () => {
        if (scrollScheduled) return;
        scrollScheduled = true;
        requestAnimationFrame(() => {
            scrollScheduled = false;
            if (containerRef) {
                containerRef.scrollTop = containerRef.scrollHeight;
            }
        });
    };

    const hasContent = createMemo(() =>
        (props.confirmedText?.length ?? 0) > 0 || (props.pendingText?.length ?? 0) > 0
    );

    let observer: MutationObserver | undefined;

    onMount(() => {
        if (containerRef) {
            observer = new MutationObserver(scrollToBottom);
            observer.observe(containerRef, { childList: true, subtree: true });
        }
    });

    onCleanup(() => {
        observer?.disconnect();
    });

    return (
        <div class={`flex flex-col h-full bg-transparent ${props.class ?? ''}`}>
            {/* Main transcript area */}
            <div
                ref={containerRef}
                class="flex-1 overflow-y-auto scroll-smooth"
            >
                <Show
                    when={hasContent()}
                    fallback={
                        <div class="flex flex-col items-center justify-center h-full opacity-50 story-font">
                            <span class="material-symbols-outlined text-5xl mb-4 text-[var(--color-earthy-soft-brown)]">graphic_eq</span>
                            <p class="text-2xl md:text-3xl leading-[1.6] text-[var(--color-earthy-muted-green)] italic">
                                {props.placeholder ?? 'Ready to transcribe...'}
                            </p>
                        </div>
                    }
                >
                    <div class="story-font space-y-12 py-4">
                        <div class="group">
                            <div class="pl-4 border-l-2 border-[var(--color-earthy-coral)]/30 group-hover:border-[var(--color-earthy-coral)]/50 transition-colors duration-300">
                                {/* Confirmed text */}
                                <p class="text-2xl md:text-3xl leading-[1.6] text-[var(--color-earthy-dark-brown)] font-normal inline">
                                    {props.confirmedText}
                                </p>

                                {/* Pending text */}
                                <Show when={props.pendingText}>
                                    <span class="text-2xl md:text-3xl leading-[1.6] text-[var(--color-earthy-coral)] font-medium italic ml-1 transition-all duration-300">
                                        {props.pendingText}
                                        <span class="inline-block w-[3px] h-8 bg-[var(--color-earthy-coral)] align-middle ml-1 opacity-60 animate-pulse" />
                                    </span>
                                </Show>
                            </div>
                        </div>

                        {/* Listening indicator when idle but recording */}
                        <Show when={props.isRecording && !props.pendingText && !props.confirmedText}>
                            <div class="flex items-center gap-3">
                                <div class="w-2 h-2 rounded-full bg-[var(--color-earthy-coral)] animate-pulse" />
                                <span class="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Listening...</span>
                                <div class="flex gap-1">
                                    <div class="w-1.5 h-1.5 bg-[var(--color-earthy-muted-green)] rounded-full animate-bounce opacity-60" />
                                    <div class="w-1.5 h-1.5 bg-[var(--color-earthy-muted-green)] rounded-full animate-bounce opacity-80 [animation-delay:0.2s]" />
                                    <div class="w-1.5 h-1.5 bg-[var(--color-earthy-muted-green)] rounded-full animate-bounce [animation-delay:0.4s]" />
                                </div>
                            </div>
                        </Show>
                    </div>
                </Show>
            </div>

            {/* Merge Stats / Legend (Floating style inside container) */}
            <Show when={props.showConfidence && props.isRecording && (props.lcsLength !== undefined)}>
                <div class="mt-4 flex items-center gap-4 text-[10px] font-bold text-[var(--color-earthy-soft-brown)] uppercase tracking-widest bg-[var(--color-earthy-bg)]/80 backdrop-blur-sm self-start px-4 py-2 rounded-full border border-[var(--color-earthy-sage)]/50">
                    <div class="flex items-center gap-1.5">
                        <span class={`w-2 h-2 rounded-full ${props.anchorValid ? 'bg-[var(--color-earthy-muted-green)]' : 'bg-[var(--color-earthy-coral)]'}`} />
                        <span>LCS: {props.lcsLength}</span>
                    </div>
                    <div class="w-px h-3 bg-[var(--color-earthy-sage)]" />
                    <span class="opacity-60">PTFA Merged</span>
                </div>
            </Show>
        </div>
    );
};

export default TranscriptionDisplay;

