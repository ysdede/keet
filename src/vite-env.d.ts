/// <reference types="vite/client" />

declare const __KEET_VERSION__: string;
declare const __PARAKEET_VERSION__: string;
declare const __PARAKEET_SOURCE__: string;
declare const __ONNXRUNTIME_VERSION__: string;

interface Window {
  requestIdleCallback(
    callback: (deadline: {
      readonly didTimeout: boolean;
      timeRemaining(): number;
    }) => void,
    options?: { timeout: number }
  ): number;
  cancelIdleCallback(handle: number): void;
}
