import { createSignal } from 'solid-js';
import { useModelSettings } from '../stores/modelStore';
import { parakeetService } from '../ParakeetService';
import './ModelSettingsPanel.css';

function ModelSettingsPanel(props) {
  const [settings, { updateSetting, reset }] = useModelSettings();
  const [isLoading, setIsLoading] = createSignal(false);

  const handleApply = async () => {
    setIsLoading(true);
    try {
      await parakeetService.reloadWithConfig(settings);
      props.onClose(); // Close panel on success
    } catch (err) {
      console.error("Failed to reload model with new settings:", err);
      // Optionally show an error message to the user
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class={`model-settings-panel ${props.isOpen ? 'open' : ''}`}>
      <h3>Model Settings</h3>

      <div class="form-grid">
        <label for="model-key">Model</label>
        <select id="model-key" value={settings.modelKey} onChange={(e) => updateSetting('modelKey', e.target.value)}>
          <option value="parakeet-tdt-0.6b-v2">Parakeet TDT 0.6B v2 (English)</option>
          <option value="parakeet-tdt-0.6b-v3">Parakeet TDT 0.6B v3 (Multilingual)</option>
          <option value="parakeet-tdt-1.1b-v2">Parakeet TDT 1.1B v2 (English)</option>
        </select>

        <label for="backend-select">Backend</label>
        <select id="backend-select" value={settings.backend} onChange={(e) => updateSetting('backend', e.target.value)}>
          <option value="webgpu-hybrid">WebGPU (Hybrid)</option>
          <option value="wasm">WASM</option>
        </select>

        <label for="encoder-quant-select">Encoder Quantization</label>
        <select id="encoder-quant-select" value={settings.encoderQuant} onChange={(e) => updateSetting('encoderQuant', e.target.value)}>
          <option value="fp32">FP32 (Higher Quality)</option>
          <option value="int8">INT8 (Faster, Lower Memory)</option>
        </select>
        
        <label for="decoder-quant-select">Decoder Quantization</label>
        <select id="decoder-quant-select" value={settings.decoderQuant} onChange={(e) => updateSetting('decoderQuant', e.target.value)}>
          <option value="int8">INT8 (Recommended)</option>
          <option value="fp32">FP32</option>
        </select>
        
        <label for="preprocessor-select">Preprocessor</label>
        <select id="preprocessor-select" value={settings.preprocessor} onChange={(e) => updateSetting('preprocessor', e.target.value)}>
          <option value="nemo128">nemo128 (default)</option>
          <option value="nemo80">nemo80</option>
        </select>
        
        <label for="stride-select">Stride</label>
        <select id="stride-select" value={settings.stride} onChange={(e) => updateSetting('stride', e.target.value)}>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>

        <label for="threads-input">Threads</label>
        <input id="threads-input" type="number" min="1" value={settings.cpuThreads} onInput={(e) => updateSetting('cpuThreads', e.target.value)} />
        
        <label class="checkbox-label">
          <input type="checkbox" checked={settings.verbose} onChange={(e) => updateSetting('verbose', e.target.checked)} />
          <span>Verbose ORT Log</span>
        </label>
      </div>
      
      <div class="panel-actions">
        <button class="btn btn-secondary" onClick={reset} disabled={isLoading()}>
          Reset to Defaults
        </button>
        <button class="btn btn-primary" onClick={handleApply} disabled={isLoading()}>
          {isLoading() ? 'Loading...' : 'Apply & Reload'}
        </button>
      </div>
    </div>
  );
}

export default ModelSettingsPanel; 