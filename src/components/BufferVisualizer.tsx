/**
"""""""""" * Keet - Buffer Visualizer Component
 * Canvas-based real-time audio waveform visualization.
 * Ported from legacy UI project (Svelte) to SolidJS.
 */

import { Component, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { AudioEngine, AudioMetrics } from '../lib/audio';
import { usePageVisible } from '../utils/usePageVisible';

interface BufferVisualizerProps {
  /** AudioEngine instance for subscribing to visualization updates */
  audioEngine?: AudioEngine;
  /** Height of the canvas in pixels (default: 80) */
  height?: number;
  /** Whether to show SNR threshold line (default: true) */
  showThreshold?: boolean;
  /** SNR threshold in dB for visualization (default: 6.0) */
  snrThreshold?: number;
  /** Whether to show time markers (default: true) */
  showTimeMarkers?: boolean;
  /** Whether the visualizer is visible (optimization - reduces frame rate when hidden) */
  visible?: boolean;
}

/** Real-time waveform and segment visualizer backed by `AudioEngine` snapshots. */
export const BufferVisualizer: Component<BufferVisualizerProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let parentRef: HTMLDivElement | undefined;

  const [isDarkSignal, setIsDarkSignal] = createSignal(false);
  const pageVisible = usePageVisible();

  let canvasWidth = 0;
  let waveformData = new Float32Array(0);
  let currentMetrics: AudioMetrics = {
    currentEnergy: 0,
    averageEnergy: 0,
    peakEnergy: 0,
    noiseFloor: 0.01,
    currentSNR: 0,
    isSpeaking: false,
  };
  let currentSegments: Array<{ startTime: number; endTime: number; isProcessed: boolean }> = [];
  let currentBufferEndTime = 0;

  const height = () => props.height ?? 80;
  const showThreshold = () => props.showThreshold ?? true;
  const snrThreshold = () => props.snrThreshold ?? 6.0;
  const showTimeMarkers = () => props.showTimeMarkers ?? true;
  const visible = () => props.visible ?? true;
  const isActive = () => visible() && pageVisible();

  let rafId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let needsRedraw = true;
  let lastDrawTime = 0;
  const DRAW_INTERVAL_MS = 33;

  const cancelLoop = () => {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
  };

  const draw = () => {
    if (!ctx || !canvasRef) return;

    const width = canvasRef.width;
    const canvasHeight = canvasRef.height;
    const centerY = canvasHeight / 2;
    const data = waveformData;
    const isDarkMode = isDarkSignal();

    ctx.clearRect(0, 0, width, canvasHeight);

    const bgColor = isDarkMode ? '#1e293b' : '#f1f5f9';
    const highlightColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.8)';
    const shadowColor = isDarkMode ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)';
    const etchColor = isDarkMode ? '#334155' : '#cbd5e1';
    const signalActiveColor = '#3b82f6';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, canvasHeight);

    ctx.beginPath();
    ctx.strokeStyle = shadowColor;
    ctx.lineWidth = 0.5;
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    if (showTimeMarkers() && props.audioEngine) {
      const textColor = '#94a3b8';
      const tickColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      drawTimeMarkers(width, canvasHeight, textColor, tickColor);
    }

    if (props.audioEngine) {
      drawSegments(width, canvasHeight, isDarkMode);
    }

    if (data.length >= 2) {
      const numPoints = data.length / 2;
      const step = width / numPoints;
      ctx.lineCap = 'round';

      const drawPath = (offsetX: number, offsetY: number) => {
        if (!ctx) return;
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const x = i * step + offsetX;
          let minVal = data[i * 2];
          let maxVal = data[i * 2 + 1];

          let yMin = centerY - (minVal * centerY * 0.9) + offsetY;
          let yMax = centerY - (maxVal * centerY * 0.9) + offsetY;

          if (Math.abs(yMax - yMin) < 1) {
            yMin = centerY - 0.5 + offsetY;
            yMax = centerY + 0.5 + offsetY;
          }

          ctx.moveTo(x, yMin);
          ctx.lineTo(x, yMax);
        }
        ctx.stroke();
      };

      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = 1.0;
      drawPath(-0.5, -0.5);

      ctx.strokeStyle = shadowColor;
      ctx.lineWidth = 1.2;
      drawPath(0.5, 0.5);

      ctx.strokeStyle = etchColor;
      ctx.lineWidth = 1.0;
      drawPath(0, 0);

      if (currentMetrics.isSpeaking) {
        ctx.globalAlpha = 0.5;
        ctx.shadowBlur = 4;
        ctx.shadowColor = signalActiveColor;
        ctx.strokeStyle = signalActiveColor;
        ctx.lineWidth = 1.0;
        drawPath(0, 0);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
      }
    }

    if (showThreshold() && currentMetrics.noiseFloor > 0) {
      const snrRatio = Math.pow(10, snrThreshold() / 10);
      const adaptiveThreshold = currentMetrics.noiseFloor * snrRatio;

      const drawThresholdLine = (offsetY: number, color: string) => {
        if (!ctx) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        const adaptiveYPos = centerY - adaptiveThreshold * centerY + offsetY;
        ctx.moveTo(0, adaptiveYPos);
        ctx.lineTo(width, adaptiveYPos);
        const adaptiveYNeg = centerY + adaptiveThreshold * centerY + offsetY;
        ctx.moveTo(0, adaptiveYNeg);
        ctx.lineTo(width, adaptiveYNeg);
        ctx.stroke();
      };

      drawThresholdLine(1, highlightColor);
      drawThresholdLine(0, shadowColor);
      ctx.setLineDash([]);

      ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)';
      ctx.font = '900 9px "JetBrains Mono", monospace';
      const labelY = centerY - adaptiveThreshold * centerY - 8;
      ctx.fillText(`THRSH: ${snrThreshold().toFixed(1)}dB`, 10, labelY);
    }

    if (currentMetrics.noiseFloor > 0) {
      const nfColor = isDarkMode ? 'rgba(74, 222, 128, 0.1)' : 'rgba(34, 197, 94, 0.1)';
      const noiseFloorY = centerY - currentMetrics.noiseFloor * centerY;
      const noiseFloorYNeg = centerY + currentMetrics.noiseFloor * centerY;

      ctx.beginPath();
      ctx.strokeStyle = nfColor;
      ctx.lineWidth = 1;
      ctx.moveTo(0, noiseFloorY);
      ctx.lineTo(width, noiseFloorY);
      ctx.moveTo(0, noiseFloorYNeg);
      ctx.lineTo(width, noiseFloorYNeg);
      ctx.stroke();
    }

    if (currentMetrics.isSpeaking) {
      const speakingColor = '#22c55e';
      const indicatorX = width - 60;
      const indicatorY = 25;
      const radius = 6;

      ctx.shadowBlur = 10;
      ctx.shadowColor = speakingColor;

      ctx.beginPath();
      ctx.arc(indicatorX, indicatorY, radius, 0, Math.PI * 2);
      ctx.fillStyle = speakingColor;
      ctx.fill();

      ctx.shadowBlur = 0;

      const time = performance.now() / 1000;
      const rippleRadius = radius + (time % 1) * 10;
      const rippleOpacity = 1 - (time % 1);

      ctx.beginPath();
      ctx.arc(indicatorX, indicatorY, rippleRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 197, 94, ${rippleOpacity})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (currentMetrics.currentSNR > 0) {
      const meterPadding = 15;
      const meterWidth = 6;
      const meterX = width - 20;
      const meterHeight = canvasHeight - (meterPadding * 2);

      ctx.fillStyle = shadowColor;
      ctx.beginPath();
      ctx.roundRect(meterX, meterPadding, meterWidth, meterHeight, 3);
      ctx.fill();

      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      const maxSNR = 60;
      const cappedSNR = Math.min(maxSNR, currentMetrics.currentSNR);
      const fillHeight = (cappedSNR / maxSNR) * meterHeight;
      const fillY = (meterPadding + meterHeight) - fillHeight;

      ctx.shadowBlur = 8;
      ctx.shadowColor =
        currentMetrics.currentSNR >= snrThreshold() ? 'rgba(34, 197, 94, 0.4)' : 'rgba(96, 165, 250, 0.4)';

      ctx.fillStyle = currentMetrics.currentSNR >= snrThreshold() ? '#22c55e' : signalActiveColor;
      ctx.beginPath();
      ctx.roundRect(meterX, fillY, meterWidth, fillHeight, 3);
      ctx.fill();

      ctx.shadowBlur = 0;

      const thresholdMarkerY = (meterPadding + meterHeight) - (Math.min(maxSNR, snrThreshold()) / maxSNR * meterHeight);
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.moveTo(meterX - 4, thresholdMarkerY);
      ctx.lineTo(meterX + meterWidth + 4, thresholdMarkerY);
      ctx.stroke();

      ctx.fillStyle = isDarkMode ? '#f8fafc' : '#1e293b';
      ctx.font = '900 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${currentMetrics.currentSNR.toFixed(0)}`, meterX - 8, thresholdMarkerY + 4);
      ctx.textAlign = 'left';
    }
  };

  const drawTimeMarkers = (width: number, canvasHeight: number, textColor: string, tickColor: string) => {
    if (!ctx || !props.audioEngine) return;

    const bufferDuration = props.audioEngine.getVisualizationDuration();
    const currentTime = currentBufferEndTime;
    const windowStart = currentTime - bufferDuration;

    ctx.fillStyle = textColor;
    ctx.font = '10px system-ui, sans-serif';

    const markerInterval = 5;
    const firstMarkerTime = Math.ceil(windowStart / markerInterval) * markerInterval;

    for (let time = firstMarkerTime; time <= currentTime; time += markerInterval) {
      const x = ((time - windowStart) / bufferDuration) * width;
      ctx.beginPath();
      ctx.strokeStyle = tickColor;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 15);
      ctx.stroke();
      ctx.fillText(`${time}s`, x + 2, 12);
    }
  };

  const drawSegments = (width: number, canvasHeight: number, isDarkMode: boolean) => {
    const context = ctx;
    if (!context || !props.audioEngine) return;

    const bufferDuration = props.audioEngine.getVisualizationDuration();
    const currentTime = currentBufferEndTime;
    const windowStart = currentTime - bufferDuration;

    const pendingBorderColor = isDarkMode ? 'rgba(250, 204, 21, 0.5)' : 'rgba(234, 179, 8, 0.5)';
    const processedBorderColor = isDarkMode ? 'rgba(34, 197, 94, 0.5)' : 'rgba(22, 163, 74, 0.5)';

    currentSegments.forEach(segment => {
      const relativeStart = segment.startTime - windowStart;
      const relativeEnd = segment.endTime - windowStart;

      if (relativeEnd > 0 && relativeStart < bufferDuration) {
        const startX = Math.floor(Math.max(0, relativeStart / bufferDuration) * width);
        const endX = Math.ceil(Math.min(1, relativeEnd / bufferDuration) * width);

        context.fillStyle = segment.isProcessed
          ? (isDarkMode ? 'rgba(34, 197, 94, 0.3)' : 'rgba(22, 163, 74, 0.3)')
          : (isDarkMode ? 'rgba(250, 204, 21, 0.3)' : 'rgba(234, 179, 8, 0.3)');
        context.fillRect(startX, 0, endX - startX, canvasHeight);

        context.strokeStyle = segment.isProcessed ? processedBorderColor : pendingBorderColor;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(startX + 0.5, 0);
        context.lineTo(startX + 0.5, canvasHeight);
        context.moveTo(endX - 0.5, 0);
        context.lineTo(endX - 0.5, canvasHeight);
        context.stroke();
      }
    });
  };

  const drawLoop = () => {
    if (!ctx || !canvasRef || canvasRef.width === 0) {
      cancelLoop();
      return;
    }

    if (!isActive()) {
      cancelLoop();
      if (needsRedraw) {
        needsRedraw = false;
        draw();
      }
      return;
    }

    const now = performance.now();
    if (needsRedraw && now - lastDrawTime >= DRAW_INTERVAL_MS) {
      lastDrawTime = now;
      needsRedraw = false;
      draw();
    }
    rafId = requestAnimationFrame(drawLoop);
  };

  const handleResize = () => {
    if (!canvasRef || !parentRef) return;
    const newWidth = parentRef.clientWidth;
    if (newWidth <= 0 || newWidth === canvasWidth) return;

    canvasRef.width = newWidth;
    canvasRef.height = height();
    canvasWidth = newWidth;

    if (props.audioEngine && isActive()) {
      waveformData = props.audioEngine.getVisualizationData(newWidth);
      currentBufferEndTime = props.audioEngine.getCurrentTime();
      currentSegments = props.audioEngine.getSegmentsForVisualization();
      needsRedraw = true;
    }
    drawLoop();
  };

  createEffect(() => {
    const engine = props.audioEngine;
    if (!engine || !isActive()) return;

    if (canvasWidth > 0) {
      waveformData = engine.getVisualizationData(canvasWidth);
      currentBufferEndTime = engine.getCurrentTime();
      currentSegments = engine.getSegmentsForVisualization();
      currentMetrics = engine.getMetrics();
      needsRedraw = true;
    }

    const sub = engine.onVisualizationUpdate((data, newMetrics, endTime) => {
      waveformData = data;
      currentMetrics = newMetrics;
      currentBufferEndTime = endTime;
      currentSegments = engine.getSegmentsForVisualization();
      needsRedraw = true;
    });

    onCleanup(() => sub());
  });

  createEffect(() => {
    visible();
    pageVisible();
    lastDrawTime = 0;
    needsRedraw = true;
    drawLoop();
  });

  onMount(() => {
    if (canvasRef) {
      ctx = canvasRef.getContext('2d');
    }

    setIsDarkSignal(document.documentElement.classList.contains('dark'));
    const themeObserver = new MutationObserver(() => {
      setIsDarkSignal(document.documentElement.classList.contains('dark'));
      needsRedraw = true;
      drawLoop();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    onCleanup(() => themeObserver.disconnect());

    handleResize();
    resizeObserver = new ResizeObserver(handleResize);
    if (parentRef) {
      resizeObserver.observe(parentRef);
    }

    drawLoop();
  });

  onCleanup(() => {
    cancelLoop();
    resizeObserver?.disconnect();
  });

  return (
    <div ref={parentRef} class="w-full relative" style={{ height: `${height()}px` }}>
      <canvas
        ref={canvasRef}
        class="w-full h-full block"
        style={{ 'image-rendering': 'auto' }}
        aria-label="Audio waveform visualization"
      />
    </div>
  );
};

export default BufferVisualizer;
