import { beforeEach, describe, expect, it } from 'vitest';
import {
  APP_SETTINGS_STORAGE_KEY,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from './settingsStorage';

describe('settingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty settings for invalid JSON', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, '{not-json');
    expect(loadSettingsFromStorage()).toEqual({});
  });

  it('loads and clamps only known fields', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({
      general: {
        energyThreshold: 99,
        sileroThreshold: -1,
        v4InferenceIntervalMs: 9000,
        v4SilenceFlushSec: -4,
        streamingWindow: 1.2,
        frameStride: 99,
        wasmThreads: 999,
      },
      model: {
        selectedModelId: 'parakeet-tdt-0.6b-v2',
        backend: 'invalid',
        encoderQuant: 'fp32',
        decoderQuant: 'int8',
      },
      audio: { selectedDeviceId: 'device-1', selectedDeviceLabel: 'Mic 1' },
      ui: {
        widgetPosition: { x: 12, y: 18 },
        debugPanel: { visible: true, height: 9999 },
        transcript: { activeTab: 'merged', mergedSplitRatio: 0.1 },
      },
      unexpected: { ignored: true },
    }));

    const loaded = loadSettingsFromStorage();
    expect(loaded.general?.energyThreshold).toBe(0.3);
    expect(loaded.general?.sileroThreshold).toBe(0.1);
    expect(loaded.general?.v4InferenceIntervalMs).toBe(8000);
    expect(loaded.general?.v4SilenceFlushSec).toBe(0.3);
    expect(loaded.general?.streamingWindow).toBe(2);
    expect(loaded.general?.frameStride).toBe(4);
    expect(loaded.general?.wasmThreads).toBe(64);
    expect(loaded.model?.selectedModelId).toBe('parakeet-tdt-0.6b-v2');
    expect(loaded.model?.backend).toBeUndefined();
    expect(loaded.model?.encoderQuant).toBe('fp32');
    expect(loaded.model?.decoderQuant).toBe('int8');
    expect(loaded.audio?.selectedDeviceId).toBe('device-1');
    expect(loaded.ui?.widgetPosition).toEqual({ x: 12, y: 18 });
    expect(loaded.ui?.debugPanel?.visible).toBe(true);
    expect(loaded.ui?.debugPanel?.height).toBe(520);
    expect(loaded.ui?.transcript?.activeTab).toBe('merged');
    expect(loaded.ui?.transcript?.mergedSplitRatio).toBe(0.3);
  });

  it('uses legacy keys when unified key has no matching fields', () => {
    localStorage.setItem('boncukjs-control-widget-pos', JSON.stringify({ x: 40, y: 80 }));
    localStorage.setItem('keet-merged-split-ratio', '0.62');

    const loaded = loadSettingsFromStorage();
    expect(loaded.ui?.widgetPosition).toEqual({ x: 40, y: 80 });
    expect(loaded.ui?.transcript?.mergedSplitRatio).toBe(0.62);
  });

  it('saves settings payload under stable key', () => {
    saveSettingsToStorage({
      model: { selectedModelId: 'parakeet-tdt-0.6b-v2' },
      ui: { transcript: { activeTab: 'live', mergedSplitRatio: 0.5 } },
    });

    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({
      model: { selectedModelId: 'parakeet-tdt-0.6b-v2' },
      ui: { transcript: { activeTab: 'live', mergedSplitRatio: 0.5 } },
    });
  });
});
