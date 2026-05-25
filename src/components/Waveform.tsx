import { Component, createEffect, onCleanup, onMount } from 'solid-js';
import type { WaveformProps } from '../types';
import { usePageVisible } from '../utils/usePageVisible';

/**
 * Oscilloscope-style waveform using AnalyserNode.getByteTimeDomainData (native, fast).
 */
export const Waveform: Component<WaveformProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let lastDrawTs = 0;
  let bgColor = '#faf8f5';
  let strokeColor = '#14b8a6';
  const FOREGROUND_FRAME_MS = 33;
  const pageVisible = usePageVisible();

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

  const cancelFrame = () => {
    if (animationId !== undefined) {
      cancelAnimationFrame(animationId);
      animationId = undefined;
    }
  };

  const isActive = () => props.isRecording && pageVisible();

  const drawFrame = () => {
    if (!ctx || !canvasRef) return;

    const w = canvasRef.width;
    const h = canvasRef.height;
    if (w === 0 || h === 0) return;

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
  };

  const requestDraw = () => {
    if (isActive()) {
      if (animationId === undefined) {
        animationId = requestAnimationFrame(animate);
      }
      return;
    }
    cancelFrame();
    drawFrame();
  };

  const animate = (ts: number) => {
    if (!ctx || !canvasRef) {
      cancelFrame();
      return;
    }

    if (!isActive()) {
      cancelFrame();
      drawFrame();
      return;
    }

    if (ts - lastDrawTs < FOREGROUND_FRAME_MS) {
      animationId = requestAnimationFrame(animate);
      return;
    }
    lastDrawTs = ts;

    drawFrame();
    animationId = requestAnimationFrame(animate);
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
      themeObserver = new MutationObserver(() => {
        refreshThemeColors();
        requestDraw();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    requestDraw();
  });

  createEffect(() => {
    pageVisible();
    props.isRecording;
    lastDrawTs = 0;
    requestDraw();
  });

  onCleanup(() => {
    cancelFrame();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
  });

  return (
    <div class="h-12 w-full overflow-hidden rounded-md bg-[var(--color-earthy-bg)]">
      <canvas ref={canvasRef} class="w-full h-full block" />
    </div>
  );
};

/** Compact wrapper around `Waveform` with defaults for tight layouts. */
export const CompactWaveform: Component<WaveformProps> = (props) => (
  <Waveform {...props} />
);

export default Waveform;
