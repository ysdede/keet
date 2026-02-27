import { Component, onCleanup, onMount } from 'solid-js';
import type { WaveformProps } from '../types';

/**
 * Oscilloscope-style waveform using AnalyserNode.getByteTimeDomainData (native, fast).
 */
export const Waveform: Component<WaveformProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | undefined;
  let timeoutId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let lastDrawTs = 0;
  let bgColor = '#faf8f5';
  let strokeColor = '#14b8a6';
  const FOREGROUND_FRAME_MS = 33;
  const IDLE_FRAME_MS = 120;
  const HIDDEN_FRAME_MS = 250;

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

  const refreshThemeColors = () => {
    if (!canvasRef) return;
    const computed = getComputedStyle(canvasRef);
    bgColor = computed.getPropertyValue('--color-earthy-bg').trim() || '#faf8f5';
    strokeColor = computed.getPropertyValue('--color-primary').trim() || '#14b8a6';
  };

  const scheduleNextFrame = (hidden: boolean, recording: boolean) => {
    if (!hidden && recording) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      animationId = requestAnimationFrame(animate);
      return;
    }
    if (animationId !== undefined) {
      cancelAnimationFrame(animationId);
      animationId = undefined;
    }
    const nextDelay = hidden ? HIDDEN_FRAME_MS : IDLE_FRAME_MS;
    timeoutId = window.setTimeout(() => animate(performance.now()), nextDelay);
  };

  const animate = (ts: number) => {
    if (!ctx || !canvasRef) {
      scheduleNextFrame(false, props.isRecording);
      return;
    }

    const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    const minFrameInterval = hidden
      ? HIDDEN_FRAME_MS
      : props.isRecording
        ? FOREGROUND_FRAME_MS
        : IDLE_FRAME_MS;
    if (ts - lastDrawTs < minFrameInterval) {
      scheduleNextFrame(hidden, props.isRecording);
      return;
    }
    lastDrawTs = ts;

    const w = canvasRef.width;
    const h = canvasRef.height;
    if (w === 0 || h === 0) {
      scheduleNextFrame(hidden, props.isRecording);
      return;
    }

    const samples = props.barLevels;
    const n = samples && samples.length > 0 ? samples.length : 0;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (props.isRecording && samples && n > 0) {
      const centerY = h / 2;
      const amp = (h / 2) * 0.9;

      ctx.strokeStyle = strokeColor;
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

    scheduleNextFrame(hidden, props.isRecording);
  };

  onMount(() => {
    if (canvasRef) {
      updateCanvasSize();
      ctx = canvasRef.getContext('2d', { alpha: false });
      refreshThemeColors();
      if (resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCanvasSize) : null) {
        resizeObserver.observe(canvasRef.parentElement ?? canvasRef);
      }
    }
    if (typeof document !== 'undefined') {
      themeObserver = new MutationObserver(() => refreshThemeColors());
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    animate(performance.now());
  });

  onCleanup(() => {
    if (animationId !== undefined) {
      cancelAnimationFrame(animationId);
    }
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
  });

  return (
    <div class="h-12 w-full overflow-hidden rounded-md bg-[var(--color-earthy-bg)]">
      <canvas ref={canvasRef} class="w-full h-full block" />
    </div>
  );
};

/** Default number of bars used by compact spectrum-like waveform renderers. */
export const SPECTRUM_BAR_COUNT = 128;

/** Compact wrapper around `Waveform` with defaults for tight layouts. */
export const CompactWaveform: Component<WaveformProps> = (props) => (
  <Waveform {...props} />
);

export default Waveform;
