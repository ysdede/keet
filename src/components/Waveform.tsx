import { Component, onCleanup, onMount } from 'solid-js';

interface WaveformProps {
  audioLevel: number;
  /** Oscilloscope samples: Float32Array -1..1 from getByteTimeDomainData */
  barLevels?: Float32Array;
  isRecording: boolean;
  barCount?: number;
}

/**
 * Oscilloscope-style waveform using AnalyserNode.getByteTimeDomainData (native, fast).
 */
export const Waveform: Component<WaveformProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;

  const updateCanvasSize = () => {
    if (!canvasRef?.parentElement) return;
    const rect = canvasRef.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (canvasRef.width !== w || canvasRef.height !== h) {
      canvasRef.width = w;
      canvasRef.height = h;
    }
  };

  const animate = () => {
    animationId = requestAnimationFrame(animate);
    if (!ctx || !canvasRef) return;

    const w = canvasRef.width;
    const h = canvasRef.height;
    if (w === 0 || h === 0) return;

    const samples = props.barLevels;
    const n = samples && samples.length > 0 ? samples.length : 0;

    const bg = getComputedStyle(canvasRef).getPropertyValue('--color-earthy-bg').trim() || '#faf8f5';
    const color = getComputedStyle(canvasRef).getPropertyValue('--color-primary').trim() || '#14b8a6';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (props.isRecording && samples && n > 0) {
      const centerY = h / 2;
      const amp = (h / 2) * 0.9;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, centerY - Math.max(-1, Math.min(1, samples[0])) * amp);
      for (let i = 1; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = centerY - Math.max(-1, Math.min(1, samples[i])) * amp;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  onMount(() => {
    if (canvasRef) {
      updateCanvasSize();
      ctx = canvasRef.getContext('2d', { alpha: false });
      if (resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCanvasSize) : null) {
        resizeObserver.observe(canvasRef.parentElement ?? canvasRef);
      }
    }
    animationId = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    cancelAnimationFrame(animationId!);
    resizeObserver?.disconnect();
  });

  return (
    <div class="h-12 w-full overflow-hidden rounded-md bg-[var(--color-earthy-bg)]">
      <canvas ref={canvasRef} class="w-full h-full block" />
    </div>
  );
};

export const SPECTRUM_BAR_COUNT = 128;

export const CompactWaveform: Component<WaveformProps> = (props) => (
  <Waveform {...props} barCount={props.barLevels?.length} />
);

export default Waveform;
