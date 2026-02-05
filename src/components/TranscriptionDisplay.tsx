/**
 * BoncukJS v3.0 - Transcription Display Component
 * 
 * Displays confirmed (stable) and pending (tentative) transcription text
 * with visual distinction. Includes merge confidence indicator for
 * the LCS+PTFA streaming merge algorithm.
 */

import { Component, Show, createMemo, onMount, onCleanup } from 'solid-js';

export interface TranscriptionDisplayProps {
    /** Confirmed/stable transcript text */
    confirmedText: string;
    /** Pending/tentative text (may change) */
    pendingText: string;
    /** Whether currently recording */
    isRecording: boolean;
    /** LCS match length from last merge (optional) */
    lcsLength?: number;
    /** Whether the anchor was valid (optional) */
    anchorValid?: boolean;
    /** Show merge confidence indicator */
    showConfidence?: boolean;
    /** Placeholder text when empty */
    placeholder?: string;
    /** Custom class for container */
    class?: string;
}

/**
 * TranscriptionDisplay - Enhanced display for streaming transcription results.
 * 
 * Features:
 * - Clear visual distinction between confirmed and pending text
 * - Smooth transitions when pending becomes confirmed
 * - Auto-scroll to latest content
 * - Optional merge confidence indicator
 * - Animated "listening" indicator when recording
 */
export const TranscriptionDisplay: Component<TranscriptionDisplayProps> = (props) => {
    let containerRef: HTMLDivElement | undefined;

    // Auto-scroll to bottom when content changes
    const scrollToBottom = () => {
        if (containerRef) {
            containerRef.scrollTop = containerRef.scrollHeight;
        }
    };

    // Create a memo for whether we have any content
    const hasContent = createMemo(() =>
        (props.confirmedText?.length ?? 0) > 0 || (props.pendingText?.length ?? 0) > 0
    );

    // Watch for content changes and scroll
    let observer: MutationObserver | undefined;

    onMount(() => {
        if (containerRef) {
            observer = new MutationObserver(scrollToBottom);
            observer.observe(containerRef, { childList: true, subtree: true, characterData: true });
        }
    });

    onCleanup(() => {
        observer?.disconnect();
    });

    // Confidence badge color based on anchor validity
    const confidenceBadge = createMemo(() => {
        if (!props.showConfidence) return null;

        if (props.anchorValid) {
            return {
                icon: 'check_circle',
                text: `Aligned (${props.lcsLength ?? 0})`,
                class: 'text-green-500 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
            };
        } else if ((props.lcsLength ?? 0) > 0) {
            return {
                icon: 'warning',
                text: `Weak (${props.lcsLength})`,
                class: 'text-yellow-500 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30'
            };
        } else {
            return {
                icon: 'error_outline',
                text: 'No overlap',
                class: 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50'
            };
        }
    });

    return (
        <div class={`flex flex-col h-full ${props.class ?? ''}`}>
            {/* Confidence indicator */}
            <Show when={props.showConfidence && props.isRecording && confidenceBadge()}>
                <div class="flex-none px-4 py-2 border-b border-gray-100 dark:border-gray-700/50">
                    <div class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${confidenceBadge()?.class}`}>
                        <span class="material-icons-round text-sm">{confidenceBadge()?.icon}</span>
                        <span>{confidenceBadge()?.text}</span>
                    </div>
                </div>
            </Show>

            {/* Main transcript area */}
            <div
                ref={containerRef}
                class="flex-1 overflow-y-auto p-4 scroll-smooth"
            >
                <Show
                    when={hasContent()}
                    fallback={
                        <p class="text-xl text-gray-400 dark:text-gray-500 italic">
                            {props.placeholder ?? 'Click the microphone to start recording...'}
                        </p>
                    }
                >
                    <div class="prose prose-lg dark:prose-invert max-w-none">
                        {/* Confirmed text - solid styling */}
                        <Show when={props.confirmedText}>
                            <span class="text-xl text-gray-800 dark:text-gray-100 leading-relaxed transition-colors duration-200">
                                {props.confirmedText}
                            </span>
                        </Show>

                        {/* Pending text - faded/italic styling */}
                        <Show when={props.pendingText}>
                            <span
                                class="text-xl text-gray-500 dark:text-gray-400 italic leading-relaxed ml-1 transition-all duration-300"
                                style={{ opacity: 0.7 }}
                            >
                                {props.pendingText}
                            </span>
                        </Show>

                        {/* Listening indicator */}
                        <Show when={props.isRecording && !props.pendingText}>
                            <span class="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500 ml-2">
                                <span class="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                <span class="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse animation-delay-100" />
                                <span class="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse animation-delay-200" />
                            </span>
                        </Show>
                    </div>
                </Show>
            </div>

            {/* Legend */}
            <Show when={props.isRecording && hasContent()}>
                <div class="flex-none px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                    <div class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-gray-800 dark:bg-gray-100" />
                        <span>Confirmed</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 opacity-70" />
                        <span class="italic">Pending</span>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default TranscriptionDisplay;
