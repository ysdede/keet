import { Component, createEffect, onCleanup, onMount } from 'solid-js';
import type { AudioEngine } from '../lib/audio/types';
import type { MelWorkerClient } from '../lib/audio/MelWorkerClient';
import { MEL_DISPLAY_DB_RANGE, MEL_DISPLAY_MIN_DB } from '../lib/audio/mel-display';
import { appStore } from '../stores/appStore';
import { usePageVisible } from '../utils/usePageVisible';

interface LayeredBufferVisualizerProps {
    /** Audio engine used for waveform and timing data. */
    audioEngine?: AudioEngine;
    /** Mel worker client used to fetch spectrogram frames. */
    melClient?: MelWorkerClient;
    /** Total canvas height in CSS pixels. */
    height?: number; // Total height
    /** Visible history window in seconds (default: 8.0). */
    windowDuration?: number; // default 8.0s
}

const MEL_BINS = 128;

const COLORMAP_LUT = (() => {
    const stops: [number, number, number, number][] = [
        [0, 0, 0, 0],
        [0.12, 0, 0, 180],
        [0.30, 120, 0, 160],
        [0.48, 0, 180, 80],
        [0.65, 220, 220, 0],
        [0.82, 255, 140, 0],
        [1, 255, 0, 0],
    ];
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
        const intensity = i / 255;
        let r = 0, g = 0, b = 0;
        for (let s = 0; s < stops.length - 1; s++) {
            const [t0, r0, g0, b0] = stops[s];
            const [t1, r1, g1, b1] = stops[s + 1];
            if (intensity >= t0 && intensity <= t1) {
                const t = (intensity - t0) / (t1 - t0);
                r = Math.round(r0 + t * (r1 - r0));
                g = Math.round(g0 + t * (g1 - g0));
                b = Math.round(b0 + t * (b1 - b0));
                break;
            }
        }
        if (intensity >= stops[stops.length - 1][0]) {
            const last = stops[stops.length - 1];
            r = last[1];
            g = last[2];
            b = last[3];
        }
        const base = i * 3;
        lut[base] = r;
        lut[base + 1] = g;
        lut[base + 2] = b;
    }
    return lut;
})();

/** Combined waveform/spectrogram timeline optimized for low-overhead debug rendering. */
export const LayeredBufferVisualizer: Component<LayeredBufferVisualizerProps> = (props) => {
    let canvasRef: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let animationFrameId: number | undefined;
    let disposed = false;

    const getWindowDuration = () => props.windowDuration || 8.0;
    const pageVisible = usePageVisible();

    let specCanvas: HTMLCanvasElement | undefined;
    let specCtx: CanvasRenderingContext2D | null = null;

    let lastSpecFetchTime = 0;
    const DRAW_INTERVAL_FOREGROUND_MS = 33;
    const SPEC_FETCH_INTERVAL_FOREGROUND_MS = 100;
    let lastDrawTime = 0;
    let needsRedraw = true;

    let cachedPhysicalWidth = 0;
    let cachedPhysicalHeight = 0;
    let cachedDpr = window.devicePixelRatio || 1;
    let resizeObserver: ResizeObserver | null = null;
    let dprMediaQuery: MediaQueryList | null = null;
    let dprChangeHandler: ((this: MediaQueryList, ev: MediaQueryListEvent) => any) | null = null;

    const updateCanvasDimensions = (logicalW: number, logicalH: number) => {
        cachedDpr = window.devicePixelRatio || 1;
        cachedPhysicalWidth = Math.floor(logicalW * cachedDpr);
        cachedPhysicalHeight = Math.floor(logicalH * cachedDpr);

        if (canvasRef && (canvasRef.width !== cachedPhysicalWidth || canvasRef.height !== cachedPhysicalHeight)) {
            canvasRef.width = cachedPhysicalWidth;
            canvasRef.height = cachedPhysicalHeight;
        }
        if (specCanvas && (specCanvas.width !== cachedPhysicalWidth || specCanvas.height !== cachedPhysicalHeight)) {
            specCanvas.width = cachedPhysicalWidth;
            specCanvas.height = cachedPhysicalHeight;
        }
    };

    let cachedSpecImgData: ImageData | null = null;
    let cachedSpecImgWidth = 0;
    let cachedSpecImgHeight = 0;
    let cachedXToT: Int32Array | null = null;
    let cachedYToM: Int32Array | null = null;
    let cacheW = 0;
    let cacheH = 0;
    let cacheTimeSteps = 0;
    let cacheMelBins = 0;

    let waveformReadBuf: Float32Array | null = null;

    let cachedSpecData: {
        features: Float32Array;
        melBins: number;
        timeSteps: number;
        startTime: number;
        endTime: number;
    } | null = null;

    const cancelLoop = () => {
        if (animationFrameId !== undefined) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = undefined;
        }
    };

    const isActive = () => pageVisible() && appStore.recordingState() === 'recording';

    const drawSpectrogramToCanvas = (
        targetCtx: CanvasRenderingContext2D,
        features: Float32Array,
        melBins: number,
        timeSteps: number,
        width: number,
        height: number
    ) => {
        if (timeSteps === 0 || width === 0 || height === 0) return;

        if (!cachedSpecImgData || cachedSpecImgWidth !== width || cachedSpecImgHeight !== height) {
            cachedSpecImgData = targetCtx.createImageData(width, height);
            cachedSpecImgWidth = width;
            cachedSpecImgHeight = height;
        }
        const imgData = cachedSpecImgData;
        const data = imgData.data;

        if (!cachedXToT || cacheW !== width || cacheTimeSteps !== timeSteps) {
            cachedXToT = new Int32Array(width);
            const timeScale = timeSteps / width;
            for (let x = 0; x < width; x++) {
                let t = (x * timeScale) | 0;
                if (t >= timeSteps) t = timeSteps - 1;
                cachedXToT[x] = t;
            }
            cacheW = width;
            cacheTimeSteps = timeSteps;
        }

        if (!cachedYToM || cacheH !== height || cacheMelBins !== melBins) {
            cachedYToM = new Int32Array(height);
            const freqScale = melBins / height;
            for (let y = 0; y < height; y++) {
                let m = ((height - 1 - y) * freqScale) | 0;
                if (m >= melBins) m = melBins - 1;
                cachedYToM[y] = m;
            }
            cacheH = height;
            cacheMelBins = melBins;
        }

        const tMap = cachedXToT;
        const mMap = cachedYToM;
        const lutScale = 255 / MEL_DISPLAY_DB_RANGE;
        let idx = 0;

        for (let y = 0; y < height; y++) {
            const rowOffset = mMap[y] * timeSteps;
            for (let x = 0; x < width; x++) {
                const val = features[rowOffset + tMap[x]];
                let lutIdx = ((val - MEL_DISPLAY_MIN_DB) * lutScale) | 0;
                if (lutIdx < 0) lutIdx = 0;
                else if (lutIdx > 255) lutIdx = 255;
                const lutBase = lutIdx * 3;

                data[idx++] = COLORMAP_LUT[lutBase];
                data[idx++] = COLORMAP_LUT[lutBase + 1];
                data[idx++] = COLORMAP_LUT[lutBase + 2];
                data[idx++] = 255;
            }
        }
        targetCtx.putImageData(imgData, 0, 0);
    };

    const WAVEFORM_GAIN = 1;

    const drawWaveform = (targetCtx: CanvasRenderingContext2D, data: Float32Array, width: number, height: number, offsetY: number) => {
        if (data.length === 0) return;

        const step = Math.ceil(data.length / width);
        const amp = (height / 2) * WAVEFORM_GAIN;
        const centerY = offsetY + height / 2;

        targetCtx.strokeStyle = '#4ade80';
        targetCtx.lineWidth = 1;
        targetCtx.beginPath();

        for (let x = 0; x < width; x++) {
            const startIdx = x * step;
            const endIdx = Math.min((x + 1) * step, data.length);

            let min = 1;
            let max = -1;
            let hasData = false;

            for (let i = startIdx; i < endIdx; i += Math.max(1, Math.floor((endIdx - startIdx) / 10))) {
                const s = data[i];
                if (s < min) min = s;
                if (s > max) max = s;
                hasData = true;
            }

            if (hasData) {
                const yMin = centerY - min * amp;
                const yMax = centerY - max * amp;
                targetCtx.moveTo(x, Math.max(offsetY, Math.min(offsetY + height, yMin)));
                targetCtx.lineTo(x, Math.max(offsetY, Math.min(offsetY + height, yMax)));
            }
        }
        targetCtx.stroke();
    };

    const drawVadLayer = (targetCtx: CanvasRenderingContext2D, width: number, height: number, offsetY: number, dpr: number) => {
        const vadState = appStore.vadState();
        const isSpeech = vadState.isSpeech;

        targetCtx.fillStyle = isSpeech ? 'rgba(249, 115, 22, 0.4)' : 'rgba(100, 116, 139, 0.2)';
        targetCtx.fillRect(0, offsetY, width, height);

        const energyLevel = appStore.audioLevel();
        const energyThreshold = appStore.energyThreshold();

        if (energyLevel > 0) {
            const barWidth = Math.min(width, width * (energyLevel / 0.3));
            targetCtx.fillStyle = energyLevel > energyThreshold ? 'rgba(249, 115, 22, 0.8)' : 'rgba(74, 222, 128, 0.6)';
            targetCtx.fillRect(width - barWidth, offsetY, barWidth, height);
        }

        targetCtx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        targetCtx.lineWidth = 1 * dpr;
        targetCtx.beginPath();
        targetCtx.moveTo(0, offsetY);
        targetCtx.lineTo(width, offsetY);
        targetCtx.stroke();

        targetCtx.fillStyle = isSpeech ? '#fb923c' : '#64748b';
        targetCtx.font = `${8 * dpr}px monospace`;
        targetCtx.fillText(isSpeech ? 'SPEECH' : 'SILENCE', 4 * dpr, offsetY + height - 2 * dpr);
    };

    const drawOverlay = (targetCtx: CanvasRenderingContext2D, width: number, height: number, duration: number, dpr: number) => {
        const triggerX = width - (1.5 / duration) * width;
        targetCtx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
        targetCtx.lineWidth = 1 * dpr;
        targetCtx.beginPath();
        targetCtx.moveTo(triggerX, 0);
        targetCtx.lineTo(triggerX, height);
        targetCtx.stroke();

        targetCtx.fillStyle = '#94a3b8';
        targetCtx.font = `${10 * dpr}px monospace`;
        for (let i = 0; i <= 8; i += 2) {
            const x = width - (i / duration) * width;
            targetCtx.fillText(`-${i}s`, x + 3 * dpr, height - 6 * dpr);
        }
    };

    const renderFrame = (now: number, allowFetch: boolean) => {
        if (!ctx || !canvasRef || !props.audioEngine) return;

        const dpr = cachedDpr;
        const width = cachedPhysicalWidth;
        const height = cachedPhysicalHeight;
        if (width === 0 || height === 0) return;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        const ringBuffer = props.audioEngine.getRingBuffer();
        const currentTime = ringBuffer.getCurrentTime();
        const duration = getWindowDuration();
        const startTime = currentTime - duration;
        const sampleRate = ringBuffer.sampleRate;

        const specHeight = Math.floor(height * 0.55);
        const waveHeight = Math.floor(height * 0.35);
        const vadHeight = height - specHeight - waveHeight;
        const waveY = specHeight;
        const vadY = specHeight + waveHeight;

        if (props.melClient && specCtx && specCanvas) {
            if (allowFetch && now - lastSpecFetchTime > SPEC_FETCH_INTERVAL_FOREGROUND_MS) {
                lastSpecFetchTime = now;
                const fetchStartSample = Math.round(startTime * sampleRate);
                const fetchEndSample = Math.round(currentTime * sampleRate);

                props.melClient.getFeatures(fetchStartSample, fetchEndSample, false).then(features => {
                    if (disposed || !features || !specCtx || !specCanvas) return;
                    cachedSpecData = {
                        features: features.features,
                        melBins: features.melBins,
                        timeSteps: features.T,
                        startTime,
                        endTime: currentTime,
                    };
                    drawSpectrogramToCanvas(specCtx, features.features, features.melBins, features.T, width, specHeight);
                    needsRedraw = true;
                    if (!animationFrameId && !disposed) {
                        renderFrame(performance.now(), false);
                    }
                }).catch(() => { });
            }

            if (cachedSpecData && cachedSpecData.timeSteps > 0) {
                const cachedDuration = cachedSpecData.endTime - cachedSpecData.startTime;
                if (cachedDuration > 0) {
                    const timeOffset = startTime - cachedSpecData.startTime;
                    const offsetX = Math.floor((timeOffset / cachedDuration) * width);
                    ctx.drawImage(specCanvas, offsetX, 0, width - offsetX, specHeight, 0, 0, width - offsetX, specHeight);
                }
            }
        }

        try {
            const startSample = Math.floor(startTime * sampleRate);
            const endSample = Math.floor(currentTime * sampleRate);
            const neededLen = endSample - startSample;
            const baseFrame = ringBuffer.getBaseFrameOffset();

            if (startSample >= baseFrame && neededLen > 0) {
                if (ringBuffer.readInto) {
                    if (!waveformReadBuf || waveformReadBuf.length < neededLen) {
                        waveformReadBuf = new Float32Array(neededLen);
                    }
                    const written = ringBuffer.readInto(startSample, endSample, waveformReadBuf);
                    drawWaveform(ctx, waveformReadBuf.subarray(0, written), width, waveHeight, waveY);
                } else {
                    const audioData = ringBuffer.read(startSample, endSample);
                    drawWaveform(ctx, audioData, width, waveHeight, waveY);
                }
            }
        } catch {
            // Data may have been overwritten; skip this frame.
        }

        drawVadLayer(ctx, width, vadHeight, vadY, dpr);
        drawOverlay(ctx, width, height, duration, dpr);
    };

    const loop = (now: number = performance.now()) => {
        if (disposed) return;
        if (!ctx || !canvasRef || !props.audioEngine) {
            cancelLoop();
            return;
        }

        if (!isActive()) {
            cancelLoop();
            if (needsRedraw) {
                needsRedraw = false;
                renderFrame(now, false);
            }
            return;
        }

        if (now - lastDrawTime < DRAW_INTERVAL_FOREGROUND_MS) {
            animationFrameId = requestAnimationFrame(loop);
            return;
        }

        lastDrawTime = now;
        needsRedraw = false;
        renderFrame(now, true);
        animationFrameId = requestAnimationFrame(loop);
    };

    onMount(() => {
        disposed = false;
        if (canvasRef) {
            ctx = canvasRef.getContext('2d', { alpha: false });

            resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const cr = entry.contentRect;
                    updateCanvasDimensions(cr.width, cr.height);
                    needsRedraw = true;
                    loop();
                }
            });
            resizeObserver.observe(canvasRef);

            const setupDprWatch = () => {
                if (dprMediaQuery && dprChangeHandler) {
                    dprMediaQuery.removeEventListener('change', dprChangeHandler);
                }
                dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
                const onDprChange = () => {
                    if (disposed) return;
                    if (canvasRef) {
                        const rect = canvasRef.getBoundingClientRect();
                        updateCanvasDimensions(rect.width, rect.height);
                    }
                    needsRedraw = true;
                    loop();
                    setupDprWatch();
                };
                dprChangeHandler = onDprChange;
                dprMediaQuery.addEventListener('change', onDprChange, { once: true });
            };
            setupDprWatch();

            const rect = canvasRef.getBoundingClientRect();
            updateCanvasDimensions(rect.width, rect.height);
        }

        specCanvas = document.createElement('canvas');
        specCtx = specCanvas.getContext('2d', { alpha: false });

        loop();
    });

    createEffect(() => {
        pageVisible();
        appStore.recordingState();
        lastDrawTime = 0;
        needsRedraw = true;
        loop();
    });

    onCleanup(() => {
        disposed = true;
        cancelLoop();
        resizeObserver?.disconnect();
        if (dprMediaQuery && dprChangeHandler) {
            dprMediaQuery.removeEventListener('change', dprChangeHandler);
        }
        dprMediaQuery = null;
        dprChangeHandler = null;
    });

    return (
        <div
            class="relative w-full bg-slate-900 rounded border border-slate-700 overflow-hidden shadow-inner"
            style={{ height: `${props.height || 200}px` }}
        >
            <canvas ref={canvasRef} class="w-full h-full block" />
            <div class="absolute top-2 left-2 text-[10px] text-slate-400 pointer-events-none">
                SPECTROGRAM + WAVEFORM ({getWindowDuration()}s)
            </div>
        </div>
    );
};
