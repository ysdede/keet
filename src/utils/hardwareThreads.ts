export const getMaxHardwareThreads = (): number => {
  if (typeof navigator === 'undefined' || !Number.isFinite(navigator.hardwareConcurrency)) {
    return 4;
  }
  return Math.max(1, Math.floor(navigator.hardwareConcurrency));
};

export const clampWasmThreadsForDevice = (value: number): number =>
  Math.max(1, Math.min(getMaxHardwareThreads(), Math.floor(value)));

