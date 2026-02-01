import { createStore } from "solid-js/store";
import { createContext, useContext } from "solid-js";

// Default settings based on Parakeet.js v1.0.1 API
const defaultModelSettings = {
  backend: 'webgpu-hybrid',
  encoderQuant: 'fp32',      // v1.0.1: renamed from 'quantization'
  decoderQuant: 'int8',      // v1.0.1: renamed from 'decoderInt8'
  preprocessor: 'nemo128',
  stride: 1,
  verbose: false,
  // Use a sensible default for threads, can be overridden by user
  cpuThreads: navigator.hardwareConcurrency ? Math.max(1, navigator.hardwareConcurrency - 2) : 4,
  // v1.0.1: Use model key instead of repo ID (supports both)
  // Available: 'parakeet-tdt-0.6b-v2' (English), 'parakeet-tdt-0.6b-v3' (Multilingual)
  modelKey: 'parakeet-tdt-0.6b-v2',
  
  // VAD (Voice Activity Detection) settings
  vadEnabled: true,
  vadModel: 'silero',  // 'silero' (ONNX, ~2MB) or 'ten' (WASM, ~277KB, lower latency)
  vadModelPath: '/models/silero/model.onnx',      // Path to Silero VAD ONNX model
  vadTenWasmPath: '/models/ten-vad/ten_vad.wasm', // Path to TEN VAD WASM
  vadTenJsPath: '/models/ten-vad/ten_vad.js',     // Path to TEN VAD JS loader
  vadThreshold: 0.6,  // Increased from 0.5 to better filter music/noise
  vadHopSize: 256,  // For TEN VAD: 160 (10ms) or 256 (16ms)
  
  // Merger mode: 'complex' (word-level alignment) or 'fast' (sentence-based)
  mergerMode: 'complex'
};

export const ModelSettingsContext = createContext();

export function ModelSettingsProvider(props) {
  const [state, setState] = createStore({ ...defaultModelSettings });

  const store = [
    state,
    {
      updateSetting(key, value) {
        // Coerce to correct type for inputs
        if (typeof defaultModelSettings[key] === 'number') {
          value = Number(value);
        }
        setState(key, value);
      },
      setMultipleSettings(settings) {
        setState(settings);
      },
      reset() {
        setState({ ...defaultModelSettings });
      }
    }
  ];

  return (
    <ModelSettingsContext.Provider value={store}>
      {props.children}
    </ModelSettingsContext.Provider>
  );
}

export function useModelSettings() { return useContext(ModelSettingsContext); } 