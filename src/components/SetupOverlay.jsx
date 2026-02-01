import { createSignal, onCleanup, onMount } from 'solid-js';
import { useModelSettings } from '../stores/modelStore';
import './ModelSettingsPanel.css'; // Re-use some of the form styles
import './SetupOverlay.css';

function SetupOverlay(props) {
  const [settings, { updateSetting }] = useModelSettings();
  const [status, setStatus] = createSignal('idle');

  const handleLoad = async () => {
    if (status() === 'idle' || status() === 'error') {
      setStatus('loading');
      if (props.worker) {
        // Convert SolidJS proxy to a plain object before sending
        const plainSettings = JSON.parse(JSON.stringify(settings));
        props.worker.postMessage({ type: 'config', data: plainSettings });
      } else {
        console.error("Worker not available to send config.");
        setStatus('error');
      }
    }
  };
  
  onMount(() => {
    if (props.worker) {
      // Temporary listener for model loading errors
      const tempErrorListener = (e) => {
        if (e.data.type === 'error' && e.data.data.message.includes('Model load failed')) {
          setStatus('error');
        }
      };
      props.worker.addEventListener('message', tempErrorListener);
      onCleanup(() => props.worker.removeEventListener('message', tempErrorListener));
    }
  });


  const statusText = () => {
    switch (status()) {
      case 'loading':
        return `Loading model... This may take a moment.`;
      case 'error':
        return 'Model failed to load. Please check console and retry.';
      default:
        return 'Configure and load the speech model to begin.';
    }
  };

  return (
    <div class="setup-overlay-backdrop">
      <div class="setup-container">
        <h2>Welcome to Boncuk.js</h2>
        <p>{statusText()}</p>

        <div class="form-grid">
          <label for="setup-model-key">Model</label>
          <select id="setup-model-key" value={settings.modelKey} onChange={(e) => updateSetting('modelKey', e.target.value)}>
            <option value="parakeet-tdt-0.6b-v2">Parakeet TDT 0.6B v2 (English)</option>
            <option value="parakeet-tdt-0.6b-v3">Parakeet TDT 0.6B v3 (Multilingual)</option>
            <option value="parakeet-tdt-1.1b-v2">Parakeet TDT 1.1B v2 (English)</option>
          </select>

          <label for="setup-backend-select">Backend</label>
          <select id="setup-backend-select" value={settings.backend} onChange={(e) => updateSetting('backend', e.target.value)}>
            <option value="webgpu-hybrid">WebGPU (Hybrid)</option>
            <option value="wasm">WASM</option>
          </select>

          <label for="setup-encoder-quant-select">Encoder Quantization</label>
          <select id="setup-encoder-quant-select" value={settings.encoderQuant} onChange={(e) => updateSetting('encoderQuant', e.target.value)}>
            <option value="fp32">FP32 (Higher Quality)</option>
            <option value="int8">INT8 (Faster, Lower Memory)</option>
          </select>
          
          <label for="setup-decoder-quant-select">Decoder Quantization</label>
          <select id="setup-decoder-quant-select" value={settings.decoderQuant} onChange={(e) => updateSetting('decoderQuant', e.target.value)}>
            <option value="int8">INT8 (Recommended)</option>
            <option value="fp32">FP32</option>
          </select>
          
          <label for="setup-preprocessor-select">Preprocessor</label>
          <select id="setup-preprocessor-select" value={settings.preprocessor} onChange={(e) => updateSetting('preprocessor', e.target.value)}>
            <option value="nemo128">nemo128 (default)</option>
            <option value="nemo80">nemo80</option>
          </select>
          
          <label for="setup-stride-select">Stride</label>
          <select id="setup-stride-select" value={settings.stride} onChange={(e) => updateSetting('stride', e.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>

          <label for="setup-threads-input">Threads</label>
          <input id="setup-threads-input" type="number" min="1" value={settings.cpuThreads} onInput={(e) => updateSetting('cpuThreads', e.target.value)} />
          
          <label class="checkbox-label">
            <input type="checkbox" checked={settings.verbose} onChange={(e) => updateSetting('verbose', e.target.checked)} />
            <span>Verbose ORT Log</span>
          </label>
        </div>

        {/* VAD Settings Section */}
        <h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Voice Activity Detection (VAD)</h3>
        <div class="form-grid">
          <label class="checkbox-label">
            <input type="checkbox" checked={settings.vadEnabled} onChange={(e) => updateSetting('vadEnabled', e.target.checked)} />
            <span>Enable VAD (filter silence/noise)</span>
          </label>

          <label for="setup-vad-model">VAD Model</label>
          <select 
            id="setup-vad-model" 
            value={settings.vadModel} 
            onChange={(e) => updateSetting('vadModel', e.target.value)}
            disabled={!settings.vadEnabled}
          >
            <option value="silero">Silero VAD (ONNX, ~2MB)</option>
            <option value="ten">TEN VAD (WASM, 277KB, lower latency)</option>
          </select>

          <label for="setup-vad-threshold">VAD Threshold</label>
          <input 
            id="setup-vad-threshold" 
            type="number" 
            min="0.1" 
            max="0.9" 
            step="0.05" 
            value={settings.vadThreshold} 
            onInput={(e) => updateSetting('vadThreshold', parseFloat(e.target.value))}
            disabled={!settings.vadEnabled}
          />

          <label for="setup-merger-mode">Merger Mode</label>
          <select id="setup-merger-mode" value={settings.mergerMode} onChange={(e) => updateSetting('mergerMode', e.target.value)}>
            <option value="complex">Complex (word-level alignment)</option>
            <option value="fast">Fast (sentence-based, NLP)</option>
          </select>
        </div>

        <button class="btn btn-primary btn-lg" onClick={handleLoad} disabled={status() === 'loading'}>
          {status() === 'loading' ? 'Loading...' : 'Load Model & Start'}
        </button>
      </div>
    </div>
  );
}

export default SetupOverlay; 