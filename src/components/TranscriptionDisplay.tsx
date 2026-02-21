import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { V4SentenceEntry } from '../lib/transcription/TranscriptionWorkerClient';
import {
    clampMergedSplitRatio,
    DEFAULT_MERGED_SPLIT_RATIO,
} from '../utils/settingsStorage';

export type TranscriptViewTab = 'live' | 'merged';

export interface TranscriptionDisplayProps {
    /** Stable/finalized transcript text. */
    confirmedText: string;
    /** Live in-progress text that can still change. */
    pendingText: string;
    /** Optional finalized sentence metadata for v4 merged view. */
    sentenceEntries?: V4SentenceEntry[];
    /** Enables v4-specific merged/live tabs and sentence timeline UI. */
    isV4Mode?: boolean;
    /** Whether recording is currently active. */
    isRecording: boolean;
    /** Longest common subsequence length used by v3 debug indicators. */
    lcsLength?: number;
    /** Whether the current v3 anchor lock is valid. */
    anchorValid?: boolean;
    /** Toggles confidence badges in token-level displays. */
    showConfidence?: boolean;
    /** Placeholder text when transcript content is empty. */
    placeholder?: string;
    /** Optional class forwarded to the root container. */
    class?: string;
    /** Controlled active tab used by external surfaces (e.g. app header). */
    activeTab?: TranscriptViewTab;
    /** Controlled tab change callback. */
    onTabChange?: (tab: TranscriptViewTab) => void;
    /** Controlled merged split ratio for the desktop merged layout. */
    mergedSplitRatio?: number;
    /** Controlled merged split ratio change callback. */
    onMergedSplitRatioChange?: (ratio: number) => void;
}

const formatClockTime = (timestamp: number): string => {
    if (!Number.isFinite(timestamp)) return '--:--:--';
    return new Date(timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const formatAudioTime = (seconds: number): string => {
    if (!Number.isFinite(seconds)) return '0:00.00';
    const totalSeconds = Math.max(0, seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secondPart = (totalSeconds % 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${secondPart}`;
};

const formatAudioRange = (startTime: number, endTime: number): string =>
    `${formatAudioTime(startTime)} -> ${formatAudioTime(endTime)}`;

/** Transcript panel that combines finalized text, live tokens, and v4 sentence history. */
export const TranscriptionDisplay: Component<TranscriptionDisplayProps> = (props) => {
    let liveContainerRef: HTMLDivElement | undefined;
    let mergedContainerRef: HTMLDivElement | undefined;
    let mergedSplitContainerRef: HTMLDivElement | undefined;
    let sentenceListDesktopRef: HTMLDivElement | undefined;
    let sentenceListMobileRef: HTMLDivElement | undefined;
    let scrollScheduled = false;
    const [internalActiveTab, setInternalActiveTab] = createSignal<TranscriptViewTab>('live');
    const activeTab = () => props.activeTab ?? internalActiveTab();
    const setActiveTab = (tab: TranscriptViewTab) => {
        if (props.onTabChange) {
            props.onTabChange(tab);
            return;
        }
        setInternalActiveTab(tab);
    };
    const [internalMergedSplitRatio, setInternalMergedSplitRatio] = createSignal(DEFAULT_MERGED_SPLIT_RATIO);
    const mergedSplitRatio = () => clampMergedSplitRatio(props.mergedSplitRatio ?? internalMergedSplitRatio());
    const setMergedSplitRatio = (ratio: number) => {
        const nextRatio = clampMergedSplitRatio(ratio);
        if (props.onMergedSplitRatioChange) {
            props.onMergedSplitRatioChange(nextRatio);
            return;
        }
        setInternalMergedSplitRatio(nextRatio);
    };
    const [isSplitResizing, setIsSplitResizing] = createSignal(false);
    let splitMouseMoveHandler: ((event: MouseEvent) => void) | null = null;
    let splitMouseUpHandler: (() => void) | null = null;

    const scrollToBottom = () => {
        if (scrollScheduled) return;
        scrollScheduled = true;
        requestAnimationFrame(() => {
            scrollScheduled = false;
            const activeContainer = activeTab() === 'merged' ? mergedContainerRef : liveContainerRef;
            if (activeContainer) {
                activeContainer.scrollTop = activeContainer.scrollHeight;
            }
        });
    };

    const getVisibleSentenceListContainer = (): HTMLDivElement | undefined => {
        if (sentenceListDesktopRef && sentenceListDesktopRef.offsetParent !== null) {
            return sentenceListDesktopRef;
        }
        if (sentenceListMobileRef && sentenceListMobileRef.offsetParent !== null) {
            return sentenceListMobileRef;
        }
        return sentenceListDesktopRef ?? sentenceListMobileRef;
    };

    const scrollSentenceListToBottom = () => {
        requestAnimationFrame(() => {
            const container = getVisibleSentenceListContainer();
            if (!container) return;
            container.scrollTop = container.scrollHeight;
        });
    };

    const startSplitResize = (event: MouseEvent) => {
        if (!mergedSplitContainerRef) return;
        event.preventDefault();

        const rect = mergedSplitContainerRef.getBoundingClientRect();
        if (rect.width <= 0) return;

        setIsSplitResizing(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const applyRatioFromClientX = (clientX: number) => {
            const nextRatio = clampMergedSplitRatio((clientX - rect.left) / rect.width);
            setMergedSplitRatio(nextRatio);
        };

        const onMouseMove = (moveEvent: MouseEvent) => {
            applyRatioFromClientX(moveEvent.clientX);
        };

        const onMouseUp = () => {
            setIsSplitResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            splitMouseMoveHandler = null;
            splitMouseUpHandler = null;
        };

        splitMouseMoveHandler = onMouseMove;
        splitMouseUpHandler = onMouseUp;
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    createEffect(() => {
        if (!props.isV4Mode && activeTab() !== 'live') {
            setActiveTab('live');
        }
    });

    const hasContent = createMemo(() =>
        (props.confirmedText?.length ?? 0) > 0 || (props.pendingText?.length ?? 0) > 0
    );

    const finalizedEntries = createMemo(() => props.sentenceEntries ?? []);
    const finalizedMergedText = createMemo(() => {
        // Avoid rebuilding the full finalized corpus while user is on Live tab.
        if (props.isV4Mode && activeTab() !== 'merged') {
            return '';
        }
        return finalizedEntries()
            .map((entry) => entry.text.trim())
            .filter((text) => text.length > 0)
            .join(' ')
            .trim();
    });
    const fullTextBody = createMemo(() => {
        const finalized = finalizedMergedText();
        const live = props.pendingText.trim();
        if (finalized && live) return `${finalized} ${live}`.trim();
        return finalized || live || '';
    });

    createEffect(() => {
        activeTab();
        props.confirmedText;
        props.pendingText;
        props.isRecording;
        finalizedEntries().length;
        scrollToBottom();
    });

    createEffect(() => {
        if (!props.isV4Mode || activeTab() !== 'merged') return;
        finalizedEntries().length;
        props.pendingText;
        scrollSentenceListToBottom();
    });

    onCleanup(() => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (splitMouseMoveHandler) {
            window.removeEventListener('mousemove', splitMouseMoveHandler);
        }
        if (splitMouseUpHandler) {
            window.removeEventListener('mouseup', splitMouseUpHandler);
        }
    });

    const renderFullTextContent = () => (
        <Show when={fullTextBody().length > 0} fallback={
            <p class="text-sm text-[var(--color-earthy-soft-brown)] italic opacity-70">
                Waiting for transcript text...
            </p>
        }>
            <p class="text-sm md:text-base lg:text-[1.05rem] text-[var(--color-earthy-dark-brown)] leading-7">
                {fullTextBody()}
            </p>
        </Show>
    );

    const renderSentenceListContent = () => (
        <Show when={finalizedEntries().length > 0 || !!props.pendingText.trim()} fallback={
            <div class="flex flex-col items-center justify-center h-full opacity-50 py-6">
                <span class="material-symbols-outlined text-3xl mb-2 text-[var(--color-earthy-soft-brown)]">view_list</span>
                <p class="text-sm text-[var(--color-earthy-soft-brown)] italic">
                    No merged conversation entries yet...
                </p>
            </div>
        }>
            <div class="space-y-0.5">
                <For each={finalizedEntries()}>
                    {(entry) => (
                        <div class="grid grid-cols-1 sm:grid-cols-[86px_138px_1fr] xl:grid-cols-[94px_150px_1fr] gap-1.5 sm:gap-3 items-baseline px-1 py-1 rounded-lg hover:bg-[var(--color-earthy-sage)]/10 transition-colors">
                            <span class="font-mono text-xs text-[var(--color-earthy-soft-brown)]">
                                {formatClockTime(entry.emittedAt)}
                            </span>
                            <span class="font-mono text-xs text-[var(--color-earthy-soft-brown)]">
                                [{formatAudioRange(entry.startTime, entry.endTime)}]
                            </span>
                            <span class="text-sm md:text-base text-[var(--color-earthy-dark-brown)]">
                                {entry.text}
                            </span>
                        </div>
                    )}
                </For>

                <Show when={props.pendingText.trim()}>
                    <div class="grid grid-cols-1 sm:grid-cols-[86px_138px_1fr] xl:grid-cols-[94px_150px_1fr] gap-1.5 sm:gap-3 items-baseline px-1 py-1 rounded-lg bg-[var(--color-earthy-muted-green)]/10 border border-[var(--color-earthy-sage)]/40">
                        <span class="font-mono text-xs text-[var(--color-earthy-soft-brown)]">
                            {formatClockTime(Date.now())}
                        </span>
                        <span class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-earthy-coral)]">
                            LIVE
                        </span>
                        <span class="text-sm md:text-base text-[var(--color-earthy-coral)] italic">
                            {props.pendingText}
                        </span>
                    </div>
                </Show>
            </div>
        </Show>
    );

    return (
        <div class={`flex flex-col h-full bg-transparent ${props.class ?? ''}`}>
            <Show when={props.isV4Mode && activeTab() === 'merged'} fallback={
                <div
                    ref={liveContainerRef}
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
            }>
                <div
                    ref={mergedContainerRef}
                    class="flex-1 overflow-y-auto scroll-smooth flex flex-col min-h-0"
                >
                    <div class="story-font py-0 space-y-1 flex-1 flex flex-col min-h-0">
                        {/* Mobile / tablet stacked layout */}
                        <div class="flex flex-col gap-1 lg:hidden min-h-0 flex-1">
                            <div class="flex-1 min-h-0 px-1 py-1 rounded-lg border border-[var(--color-earthy-sage)]/40 bg-[var(--color-earthy-sage)]/10 flex flex-col">
                                <div class="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-0.5 shrink-0">
                                    Full Text Body
                                </div>
                                <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
                                    {renderFullTextContent()}
                                </div>
                            </div>

                            <div class="flex-1 min-h-0 px-1 py-1 rounded-lg border border-[var(--color-earthy-sage)]/40 bg-[var(--color-earthy-bg)]/60 flex flex-col">
                                <div class="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-0.5 shrink-0">
                                    Sentence List
                                </div>
                                <div ref={sentenceListMobileRef} class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
                                    {renderSentenceListContent()}
                                </div>
                            </div>
                        </div>

                        {/* Desktop adjustable split layout (defaults to 50/50) */}
                        <div
                            ref={mergedSplitContainerRef}
                            class="hidden lg:flex items-stretch flex-1 min-h-0"
                        >
                            <div
                                class="min-w-0 px-1 py-1 rounded-l-lg border border-[var(--color-earthy-sage)]/40 bg-[var(--color-earthy-sage)]/10 flex flex-col"
                                style={{ width: `calc(${(mergedSplitRatio() * 100).toFixed(3)}% - 6px)` }}
                            >
                                <div class="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-0.5 shrink-0">
                                    Full Text Body
                                </div>
                                <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
                                    {renderFullTextContent()}
                                </div>
                            </div>

                            <div
                                class="w-3 shrink-0 relative cursor-col-resize group touch-none"
                                onMouseDown={startSplitResize}
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="Adjust merged split"
                            >
                                <div class={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${isSplitResizing()
                                        ? 'bg-[var(--color-earthy-muted-green)]'
                                        : 'bg-[var(--color-earthy-sage)]/70 group-hover:bg-[var(--color-earthy-soft-brown)]/80'
                                    }`} />
                                <div class={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-10 rounded-full border transition-colors ${isSplitResizing()
                                        ? 'bg-[var(--color-earthy-sage)] border-[var(--color-earthy-muted-green)]/80'
                                        : 'bg-[var(--color-earthy-bg)] border-[var(--color-earthy-sage)]/60 group-hover:border-[var(--color-earthy-soft-brown)]/80'
                                    }`} />
                            </div>

                            <div
                                class="min-w-0 px-1 py-1 rounded-r-lg border border-[var(--color-earthy-sage)]/40 bg-[var(--color-earthy-bg)]/60 flex flex-col"
                                style={{ width: `calc(${((1 - mergedSplitRatio()) * 100).toFixed(3)}% - 6px)` }}
                            >
                                <div class="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-earthy-soft-brown)] mb-0.5 shrink-0">
                                    Sentence List
                                </div>
                                <div ref={sentenceListDesktopRef} class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
                                    {renderSentenceListContent()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Show>

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

