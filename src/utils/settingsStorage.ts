export const APP_SETTINGS_STORAGE_KEY = 'keet-app-settings';
const LEGACY_WIDGET_POSITION_STORAGE_KEY = 'boncukjs-control-widget-pos';
const LEGACY_MERGED_SPLIT_STORAGE_KEY = 'keet-merged-split-ratio';

export const MIN_DEBUG_PANEL_HEIGHT = 120;
export const MAX_DEBUG_PANEL_HEIGHT = 520;
export const DEFAULT_DEBUG_PANEL_HEIGHT = 220;

export const MIN_MERGED_SPLIT_RATIO = 0.3;
export const MAX_MERGED_SPLIT_RATIO = 0.7;
export const DEFAULT_MERGED_SPLIT_RATIO = 0.5;

export type StoredTranscriptTab = 'live' | 'merged';

export interface PersistedSettings {
  general?: {
    energyThreshold?: number;
    sileroThreshold?: number;
    v4InferenceIntervalMs?: number;
    v4SilenceFlushSec?: number;
    streamingWindow?: number;
  };
  model?: {
    selectedModelId?: string;
  };
  audio?: {
    selectedDeviceId?: string;
    selectedDeviceLabel?: string;
  };
  ui?: {
    widgetPosition?: {
      x: number;
      y: number;
    };
    debugPanel?: {
      visible?: boolean;
      height?: number;
    };
    transcript?: {
      activeTab?: StoredTranscriptTab;
      mergedSplitRatio?: number;
    };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const readFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const readNumberInRange = (value: unknown, min: number, max: number): number | undefined => {
  const numeric = readFiniteNumber(value);
  if (numeric === undefined) return undefined;
  return clamp(numeric, min, max);
};

const readIntegerInRange = (value: unknown, min: number, max: number): number | undefined => {
  const numeric = readFiniteNumber(value);
  if (numeric === undefined) return undefined;
  return Math.round(clamp(numeric, min, max));
};

const readString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value !== 'boolean') return undefined;
  return value;
};

export const clampDebugPanelHeight = (height: number): number =>
  clamp(height, MIN_DEBUG_PANEL_HEIGHT, MAX_DEBUG_PANEL_HEIGHT);

export const clampMergedSplitRatio = (ratio: number): number =>
  clamp(ratio, MIN_MERGED_SPLIT_RATIO, MAX_MERGED_SPLIT_RATIO);

const readWidgetPosition = (value: unknown): { x: number; y: number } | undefined => {
  if (!isRecord(value)) return undefined;
  const x = readFiniteNumber(value.x);
  const y = readFiniteNumber(value.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
};

const readTranscriptTab = (value: unknown): StoredTranscriptTab | undefined => {
  if (value === 'live' || value === 'merged') return value;
  return undefined;
};

const sanitizeSettings = (value: unknown): PersistedSettings => {
  if (!isRecord(value)) return {};

  const settings: PersistedSettings = {};

  const general = isRecord(value.general) ? value.general : null;
  if (general) {
    const nextGeneral: PersistedSettings['general'] = {};
    nextGeneral.energyThreshold = readNumberInRange(general.energyThreshold, 0.005, 0.3);
    nextGeneral.sileroThreshold = readNumberInRange(general.sileroThreshold, 0.1, 0.9);
    nextGeneral.v4InferenceIntervalMs = readIntegerInRange(general.v4InferenceIntervalMs, 160, 8000);
    nextGeneral.v4SilenceFlushSec = readNumberInRange(general.v4SilenceFlushSec, 0.3, 5.0);
    nextGeneral.streamingWindow = readNumberInRange(general.streamingWindow, 2.0, 15.0);
    if (Object.values(nextGeneral).some((v) => v !== undefined)) {
      settings.general = nextGeneral;
    }
  }

  const model = isRecord(value.model) ? value.model : null;
  if (model) {
    const selectedModelId = readString(model.selectedModelId);
    if (selectedModelId) {
      settings.model = { selectedModelId };
    }
  }

  const audio = isRecord(value.audio) ? value.audio : null;
  if (audio) {
    const selectedDeviceId = readString(audio.selectedDeviceId);
    const selectedDeviceLabel = readString(audio.selectedDeviceLabel);
    if (selectedDeviceId || selectedDeviceLabel) {
      settings.audio = {};
      if (selectedDeviceId) settings.audio.selectedDeviceId = selectedDeviceId;
      if (selectedDeviceLabel) settings.audio.selectedDeviceLabel = selectedDeviceLabel;
    }
  }

  const ui = isRecord(value.ui) ? value.ui : null;
  if (ui) {
    const nextUi: PersistedSettings['ui'] = {};

    const widgetPosition = readWidgetPosition(ui.widgetPosition);
    if (widgetPosition) nextUi.widgetPosition = widgetPosition;

    const debugPanel = isRecord(ui.debugPanel) ? ui.debugPanel : null;
    if (debugPanel) {
      const visible = readBoolean(debugPanel.visible);
      const heightValue = readFiniteNumber(debugPanel.height);
      const height = heightValue === undefined ? undefined : clampDebugPanelHeight(heightValue);
      if (visible !== undefined || height !== undefined) {
        nextUi.debugPanel = {};
        if (visible !== undefined) nextUi.debugPanel.visible = visible;
        if (height !== undefined) nextUi.debugPanel.height = height;
      }
    }

    const transcript = isRecord(ui.transcript) ? ui.transcript : null;
    if (transcript) {
      const activeTab = readTranscriptTab(transcript.activeTab);
      const mergedSplitValue = readFiniteNumber(transcript.mergedSplitRatio);
      const mergedSplitRatio =
        mergedSplitValue === undefined ? undefined : clampMergedSplitRatio(mergedSplitValue);
      if (activeTab || mergedSplitRatio !== undefined) {
        nextUi.transcript = {};
        if (activeTab) nextUi.transcript.activeTab = activeTab;
        if (mergedSplitRatio !== undefined) nextUi.transcript.mergedSplitRatio = mergedSplitRatio;
      }
    }

    if (nextUi.widgetPosition || nextUi.debugPanel || nextUi.transcript) {
      settings.ui = nextUi;
    }
  }

  return settings;
};

const readLegacyWidgetPosition = (): { x: number; y: number } | undefined => {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(LEGACY_WIDGET_POSITION_STORAGE_KEY);
    if (!raw) return undefined;
    return readWidgetPosition(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

const readLegacySplitRatio = (): number | undefined => {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(LEGACY_MERGED_SPLIT_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    return clampMergedSplitRatio(parsed);
  } catch {
    return undefined;
  }
};

export const loadSettingsFromStorage = (): PersistedSettings => {
  if (typeof localStorage === 'undefined') return {};

  let parsed: unknown = null;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const settings = sanitizeSettings(parsed);
  const legacyWidgetPosition = readLegacyWidgetPosition();
  const legacySplitRatio = readLegacySplitRatio();

  if (legacyWidgetPosition && !settings.ui?.widgetPosition) {
    settings.ui = settings.ui ?? {};
    settings.ui.widgetPosition = legacyWidgetPosition;
  }

  if (legacySplitRatio !== undefined && !settings.ui?.transcript?.mergedSplitRatio) {
    settings.ui = settings.ui ?? {};
    settings.ui.transcript = settings.ui.transcript ?? {};
    settings.ui.transcript.mergedSplitRatio = legacySplitRatio;
  }

  return settings;
};

export const saveSettingsToStorage = (settings: PersistedSettings): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota/security errors and keep runtime defaults.
  }
};
