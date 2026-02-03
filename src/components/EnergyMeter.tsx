import { Component, createSignal, onCleanup, onMount } from 'solid-js';
import { AudioEngine } from '../lib/audio/types';
import { appStore } from '../stores/appStore';

interface EnergyMeterProps {
    audioEngine?: AudioEngine;
}

export const EnergyMeter: Component<EnergyMeterProps> = (props) => {
    const [energy, setEnergy] = createSignal(0);
    const [metrics, setMetrics] = createSignal({ noiseFloor: 0, snr: 0, threshold: 0.02, snrThreshold: 3.0 });
    const [isSpeaking, setIsSpeaking] = createSignal(false);

    let animId: number;

    const update = () => {
        if (!props.audioEngine) return;

        const currentE = props.audioEngine.getCurrentEnergy();
        const currentM = props.audioEngine.getSignalMetrics();

        setEnergy(currentE);
        setMetrics(currentM);
        // Check if speaking based on SNR threshold (matching VAD logic)
        setIsSpeaking(currentM.snr > currentM.snrThreshold || currentE > currentM.threshold);
        animId = requestAnimationFrame(update);
    };

    onMount(() => {
        animId = requestAnimationFrame(update);
    });

    onCleanup(() => cancelAnimationFrame(animId));

    // Logarithmic scaling for better visualization
    const toPercent = (val: number) => {
        // e.g. mapping 0.0001 -> 1.0 to 0% -> 100% log scale
        // log10(0.0001) = -4, log10(1) = 0
        const minLog = -4;
        const maxLog = 0;
        const v = Math.max(0.0001, val);
        const log = Math.log10(v);
        return Math.max(0, Math.min(100, ((log - minLog) / (maxLog - minLog)) * 100));
    };

    return (
        <div class="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Signal Analysis</h3>
                {/* Speaking indicator */}
                <span class={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isSpeaking() 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' 
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                    {isSpeaking() ? 'SPEECH' : 'SILENCE'}
                </span>
            </div>

            {/* Energy Bar */}
            <div class="relative w-full h-4 bg-gray-200 dark:bg-gray-900 rounded-full overflow-hidden">
                {/* Energy Fill - color based on speech state */}
                <div
                    class={`absolute top-0 bottom-0 left-0 transition-all duration-75 ${
                        isSpeaking() ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${toPercent(energy())}%` }}
                />

                {/* Noise Floor Marker */}
                <div
                    class="absolute top-0 bottom-0 w-1 bg-yellow-500 opacity-70"
                    style={{ left: `${toPercent(metrics().noiseFloor)}%` }}
                    title={`Noise Floor: ${metrics().noiseFloor.toFixed(5)}`}
                />

                {/* Energy Threshold Marker */}
                <div
                    class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                    style={{ left: `${toPercent(metrics().threshold)}%` }}
                    title={`Energy Threshold: ${metrics().threshold}`}
                />
            </div>

            <div class="flex justify-between text-xs text-gray-500">
                <span>Noise: {metrics().noiseFloor.toFixed(5)}</span>
                <span>Energy: {energy().toFixed(4)}</span>
                <span class={metrics().snr > metrics().snrThreshold ? 'text-green-600 font-bold' : metrics().snr > 0 ? 'text-yellow-600' : 'text-red-600'}>
                    SNR: {metrics().snr.toFixed(1)} dB (th: {metrics().snrThreshold})
                </span>
            </div>
        </div>
    );
};
