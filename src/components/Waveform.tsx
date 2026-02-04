/**
 * BoncukJS v2.0 - Waveform Visualization Component
 */

import { Component, For, createSignal, onCleanup, onMount } from 'solid-js';

interface WaveformProps {
  audioLevel: number;
  isRecording: boolean;
  barCount?: number;
}

export const Waveform: Component<WaveformProps> = (props) => {
  const barCount = () => props.barCount ?? 24;
  const [barHeights, setBarHeights] = createSignal<number[]>([]);

  onMount(() => {
    setBarHeights(Array.from({ length: barCount() }, () => Math.random()));
  });

  let animationId: number | undefined;

  const animate = () => {
    if (props.isRecording) {
      const level = props.audioLevel;
      setBarHeights(prev =>
        prev.map(() => {
          // Significant boost for visualization sensitivity
          const base = level * 20.0 + Math.random() * 0.1;
          return Math.min(1, Math.max(0.1, base));
        })
      );
    } else {
      setBarHeights(prev => prev.map(() => 0.05 + Math.random() * 0.05));
    }
    animationId = requestAnimationFrame(animate);
  };

  onMount(() => {
    animationId = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    if (animationId) cancelAnimationFrame(animationId);
  });

  return (
    <div class="flex items-center justify-end gap-[6px] h-10 px-5 nm-inset rounded-[24px] bg-slate-500/5 overflow-hidden">
      <For each={barHeights()}>
        {(height) => (
          <div
            class={`w-1 rounded-full transition-all duration-75 ${props.isRecording
                ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5),_inset_0.5px_0.5px_1px_rgba(255,255,255,0.4),_inset_-0.5px_-0.5px_1px_rgba(0,0,0,0.2)]'
                : 'bg-slate-300 dark:bg-slate-700 shadow-[inset_0.5px_0.5px_1px_rgba(0,0,0,0.2),_0.5px_0.5px_1px_rgba(255,255,255,0.1)]'
              }`}
            style={{
              height: `${Math.max(15, height * 100)}%`,
              opacity: props.isRecording ? 1 : 0.6,
            }}
          />
        )}
      </For>
    </div>
  );
};

export const CompactWaveform: Component<WaveformProps> = (props) => {
  return <Waveform {...props} barCount={24} />;
};

export default Waveform;
