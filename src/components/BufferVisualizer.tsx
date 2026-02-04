/**
 * BoncukJS - Buffer Visualizer Component
 * Canvas-based real-time audio waveform visualization.
 * Ported from parakeet-ui (Svelte) to SolidJS.
 */

import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import type { AudioEngine, AudioMetrics } from '../lib/audio';

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

export const BufferVisualizer: Component<BufferVisualizerProps> = (props) => {
  // Canvas element ref
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let parentRef: HTMLDivElement | undefined;

  // State
  const [canvasWidth, setCanvasWidth] = createSignal(0);
  const [waveformData, setWaveformData] = createSignal<Float32Array>(new Float32Array(0));
  const [metrics, setMetrics] = createSignal<AudioMetrics>({
    currentEnergy: 0,
    averageEnergy: 0,
    peakEnergy: 0,
    noiseFloor: 0.01,
    currentSNR: 0,
    isSpeaking: false,
  });
  const [segments, setSegments] = createSignal<Array<{ startTime: number; endTime: number; isProcessed: boolean }>>([]);

  const height = () => props.height ?? 80;
  const showThreshold = () => props.showThreshold ?? true;
  const snrThreshold = () => props.snrThreshold ?? 6.0;
  const showTimeMarkers = () => props.showTimeMarkers ?? true;
  const visible = () => props.visible ?? true;

  let animationFrameId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;

  // Draw function
  const draw = () => {
    if (!ctx || !canvasRef) return;

    const width = canvasRef.width;
    const canvasHeight = canvasRef.height;
    const centerY = canvasHeight / 2;
    const data = waveformData();
    const currentMetrics = metrics();

    // Clear canvas
    ctx.clearRect(0, 0, width, canvasHeight);

    // Get CSS variables for theme-aware colors
    const computedStyle = getComputedStyle(document.documentElement);
    const isDarkMode = document.documentElement.classList.contains('dark');

    // Colors (Mechanical Etched Palette)
    const bgColor = isDarkMode ? '#1e293b' : '#f0f2f5';
    const highlightColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.8)';
    const shadowColor = isDarkMode ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)';
    const etchColor = isDarkMode ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)';
    const signalActiveColor = '#3b82f6'; // Keep active elements blue but subtle

    // Background
    if (ctx) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, canvasHeight);

      // Baseline (Etched indent)
      ctx.beginPath();
      ctx.strokeStyle = shadowColor;
      ctx.lineWidth = 0.5;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw time markers at the top
      if (showTimeMarkers() && props.audioEngine) {
        // Use the new textColor and tickColor based on the etched palette
        const textColor = isDarkMode ? '#94a3b8' : '#94a3b8';
        const tickColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        drawTimeMarkers(width, canvasHeight, textColor, tickColor);
      }

      // Draw segment boundaries (before waveform so they appear behind)
      if (props.audioEngine) {
        drawSegments(width, canvasHeight, isDarkMode);
      }

      // Draw waveform using high-fidelity bucketed downsampling - Etched Mercury Line
      if (data.length >= 2) {
        // Higher resolution for a true waveform look (approx 400-500 buckets)
        const numBuckets = Math.min(500, Math.floor(width / 1.5));
        const bucketSize = Math.floor(data.length / (numBuckets * 2));
        const bucketWidth = width / numBuckets;

        // Bucket aggregated data (Max Peaks)
        const bucketedPeaks: number[] = [];
        for (let b = 0; b < numBuckets; b++) {
          let maxVal = 0;
          for (let s = 0; s < bucketSize; s++) {
            const idx = (b * bucketSize + s) * 2;
            if (idx + 1 < data.length) {
              const val = Math.abs(data[idx + 1]);
              if (val > maxVal) maxVal = val;
            }
          }
          bucketedPeaks.push(maxVal);
        }

        const drawEngravedLines = (offsetX: number, offsetY: number, strokeColor: string, lineWidth: number) => {
          if (!ctx) return;
          ctx.beginPath();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';

          for (let i = 0; i < numBuckets; i++) {
            const x = (i * bucketWidth) + offsetX;
            const peak = bucketedPeaks[i];

            // Draw a symmetrical line
            const yMin = centerY - (peak * centerY * 0.9) + offsetY;
            const yMax = centerY + (peak * centerY * 0.9) + offsetY;

            if (peak > 0.005) {
              ctx.moveTo(x, yMin);
              ctx.lineTo(x, yMax);
            }
          }
          ctx.stroke();
        };

        // 1. Highlight Pass (Sharp top-left edge)
        drawEngravedLines(-0.3, -0.3, highlightColor, 1.2);

        // 2. Shadow Pass (Depressed groove)
        drawEngravedLines(0.6, 0.6, shadowColor, 1.5);

        // 3. Main Etch Pass (Base material color)
        drawEngravedLines(0, 0, etchColor, 1.2);

        // 4. Subtle Active signal glow during speaking
        if (currentMetrics.isSpeaking) {
          ctx.globalAlpha = 0.5;
          ctx.shadowBlur = 4;
          ctx.shadowColor = signalActiveColor;
          drawEngravedLines(0, 0, signalActiveColor, 1.0);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1.0;
        }
      }

      // Draw adaptive threshold (Etched dashes)
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
          ctx.moveTo(0, adaptiveYPos); ctx.lineTo(width, adaptiveYPos);
          const adaptiveYNeg = centerY + adaptiveThreshold * centerY + offsetY;
          ctx.moveTo(0, adaptiveYNeg); ctx.lineTo(width, adaptiveYNeg);
          ctx.stroke();
        };

        drawThresholdLine(1, highlightColor);
        drawThresholdLine(0, shadowColor);
        ctx.setLineDash([]);

        // Label (Etched text)
        ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)';
        ctx.font = '900 9px "JetBrains Mono", monospace';
        const labelY = centerY - adaptiveThreshold * centerY - 8;
        ctx.fillText(`THRSH: ${snrThreshold().toFixed(1)}dB`, 10, labelY);
      }

      // Draw noise floor level (retained original style for clarity)
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

      // Draw speaking indicator (Neumorphic dot)
      if (currentMetrics.isSpeaking) {
        const speakingColor = '#22c55e';
        const indicatorX = width - 60;
        const indicatorY = 25;
        const radius = 6;

        // Glow effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = speakingColor;

        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, radius, 0, Math.PI * 2);
        ctx.fillStyle = speakingColor;
        ctx.fill();

        ctx.shadowBlur = 0;

        // Pulse ring
        const time = performance.now() / 1000;
        const rippleRadius = radius + (time % 1) * 10;
        const rippleOpacity = 1 - (time % 1);

        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, rippleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 197, 94, ${rippleOpacity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // SNR meter on the right side - Etched mechanical gauge
      if (currentMetrics.currentSNR > 0) {
        const meterPadding = 15;
        const meterWidth = 6;
        const meterX = width - 20;
        const meterHeight = canvasHeight - (meterPadding * 2);

        // Meter Housing (Inset)
        ctx.fillStyle = shadowColor;
        ctx.beginPath();
        ctx.roundRect(meterX, meterPadding, meterWidth, meterHeight, 3);
        ctx.fill();

        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Gauge Level
        const maxSNR = 60;
        const cappedSNR = Math.min(maxSNR, currentMetrics.currentSNR);
        const fillHeight = (cappedSNR / maxSNR) * meterHeight;
        const fillY = (meterPadding + meterHeight) - fillHeight;

        // Glow for the active portion
        ctx.shadowBlur = 8;
        ctx.shadowColor = currentMetrics.currentSNR >= snrThreshold() ? 'rgba(34, 197, 94, 0.4)' : 'rgba(96, 165, 250, 0.4)';

        ctx.fillStyle = currentMetrics.currentSNR >= snrThreshold() ? '#22c55e' : signalActiveColor;
        ctx.beginPath();
        ctx.roundRect(meterX, fillY, meterWidth, fillHeight, 3);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Threshold marker notched in
        const thresholdMarkerY = (meterPadding + meterHeight) - (Math.min(maxSNR, snrThreshold()) / maxSNR * meterHeight);
        ctx.beginPath();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.moveTo(meterX - 4, thresholdMarkerY);
        ctx.lineTo(meterX + meterWidth + 4, thresholdMarkerY);
        ctx.stroke();

        // Digital Readout
        ctx.fillStyle = isDarkMode ? '#f8fafc' : '#1e293b';
        ctx.font = '900 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${currentMetrics.currentSNR.toFixed(0)}`, meterX - 8, thresholdMarkerY + 4);
        ctx.textAlign = 'left';
      }
    }
  };

  // Draw time markers
  const drawTimeMarkers = (width: number, canvasHeight: number, textColor: string, tickColor: string) => {
    if (!ctx || !props.audioEngine) return;

    const bufferDuration = props.audioEngine.getVisualizationDuration();
    const currentTime = props.audioEngine.getCurrentTime();
    const windowStart = currentTime - bufferDuration;

    ctx.fillStyle = textColor;
    ctx.font = '10px system-ui, sans-serif';

    const markerInterval = 5; // Every 5 seconds
    for (let i = 0; i <= bufferDuration; i += markerInterval) {
      const x = (i / bufferDuration) * width;
      const time = Math.floor(windowStart + i);

      if (time >= 0) {
        // Draw tick mark
        ctx.beginPath();
        ctx.strokeStyle = tickColor;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 15);
        ctx.stroke();

        // Draw time label
        ctx.fillText(`${time}s`, x + 2, 12);
      }
    }
  };

  // Draw segment boundaries
  const drawSegments = (width: number, canvasHeight: number, isDarkMode: boolean) => {
    const context = ctx;
    if (!context || !props.audioEngine) return;

    const bufferDuration = props.audioEngine.getVisualizationDuration();
    const currentTime = props.audioEngine.getCurrentTime();
    const windowStart = currentTime - bufferDuration;
    const segmentList = segments();

    // Colors for segments
    const pendingColor = isDarkMode ? 'rgba(250, 204, 21, 0.15)' : 'rgba(234, 179, 8, 0.15)';
    const processedColor = isDarkMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(22, 163, 74, 0.15)';
    const pendingBorderColor = isDarkMode ? 'rgba(250, 204, 21, 0.5)' : 'rgba(234, 179, 8, 0.5)';
    const processedBorderColor = isDarkMode ? 'rgba(34, 197, 94, 0.5)' : 'rgba(22, 163, 74, 0.5)';

    segmentList.forEach(segment => {
      // Calculate relative position in visualization window
      const relativeStart = segment.startTime - windowStart;
      const relativeEnd = segment.endTime - windowStart;

      // Only draw if segment is within visible window
      if (relativeEnd > 0 && relativeStart < bufferDuration) {
        const startX = Math.max(0, (relativeStart / bufferDuration)) * width;
        const endX = Math.min(1, (relativeEnd / bufferDuration)) * width;

        // Fill segment area
        context.fillStyle = segment.isProcessed ? processedColor : pendingColor;
        context.fillRect(startX, 0, endX - startX, canvasHeight);

        // Draw segment boundaries
        context.strokeStyle = segment.isProcessed ? processedBorderColor : pendingBorderColor;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(startX, 0);
        context.lineTo(startX, canvasHeight);
        context.moveTo(endX, 0);
        context.lineTo(endX, canvasHeight);
        context.stroke();
      }
    });
  };

  // Animation loop
  const drawLoop = () => {
    if (!ctx || !canvasRef || canvasRef.width === 0) {
      if (visible()) {
        animationFrameId = requestAnimationFrame(drawLoop);
      } else {
        animationFrameId = window.setTimeout(drawLoop, 100) as unknown as number;
      }
      return;
    }

    if (visible()) {
      draw();
      animationFrameId = requestAnimationFrame(drawLoop);
    } else {
      // When not visible, check less frequently to save CPU
      animationFrameId = window.setTimeout(drawLoop, 100) as unknown as number;
    }
  };

  // Resize handler
  const handleResize = () => {
    if (canvasRef && parentRef) {
      const newWidth = parentRef.clientWidth;
      if (newWidth > 0 && newWidth !== canvasWidth()) {
        canvasRef.width = newWidth;
        canvasRef.height = height();
        setCanvasWidth(newWidth);

        // Refetch visualization data for new width
        if (props.audioEngine && visible()) {
          setWaveformData(props.audioEngine.getVisualizationData(newWidth));
        }
      }
    }
  };

  // Subscribe to audio engine updates
  createEffect(() => {
    const engine = props.audioEngine;
    if (engine && visible()) {
      // Initial data fetch
      if (canvasWidth() > 0) {
        setWaveformData(engine.getVisualizationData(canvasWidth()));
      }

      // Subscribe to updates
      const sub = engine.onVisualizationUpdate((data, newMetrics) => {
        if (visible()) {
          // Refetch data for current canvas width (more accurate)
          if (canvasWidth() > 0) {
            setWaveformData(engine.getVisualizationData(canvasWidth()));
          } else {
            setWaveformData(data);
          }
          setMetrics(newMetrics);

          // Fetch segments for visualization
          setSegments(engine.getSegmentsForVisualization());
        } else {
          // Still update metrics even when not visible
          setMetrics(newMetrics);
        }
      });

      onCleanup(() => sub());
    }
  });

  onMount(() => {
    if (canvasRef) {
      ctx = canvasRef.getContext('2d');
    }

    // Setup resize observer
    handleResize();
    resizeObserver = new ResizeObserver(handleResize);
    if (parentRef) {
      resizeObserver.observe(parentRef);
    }

    // Start animation loop
    animationFrameId = requestAnimationFrame(drawLoop);
  });

  onCleanup(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(animationFrameId);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  return (
    <div ref={parentRef} class="w-full relative" style={{ height: `${height()}px` }}>
      <canvas
        ref={canvasRef}
        class="w-full h-full block liquid-mercury"
        style={{ 'image-rendering': 'auto' }}
        aria-label="Audio waveform visualization"
      />
    </div>
  );
};

export default BufferVisualizer;
