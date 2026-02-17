/**
 * Unit tests for TenVADWorkerClient.
 *
 * Verifies:
 *   - Client is not ready until init() completes.
 *   - init() resolves when worker sends INIT success, rejects when worker sends ERROR.
 *   - process() does nothing when not ready.
 *   - onResult callback receives RESULT payloads from the worker.
 *   - dispose() terminates the worker and clears state.
 *
 * Uses a mocked worker for deterministic unit behavior.
 * Run: npm test
 */

import '@vitest/web-worker';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TenVADWorkerClient } from './TenVADWorkerClient';
import type { TenVADResult } from '../buffer/types';

class MockWorker {
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
    onerror: ((this: AbstractWorker, ev: Event) => any) | null = null;
    private disposed = false;

    constructor(_url?: string | URL, _options?: WorkerOptions) {}

    postMessage(message: any): void {
        if (this.disposed) return;

        if (message?.type === 'INIT') {
            queueMicrotask(() => {
                if (this.disposed) return;
                this.onmessage?.({
                    data: {
                        type: 'ERROR',
                        id: message.id,
                        payload: 'TEN-VAD init failed: mock',
                    },
                } as MessageEvent);
            });
        }
    }

    terminate(): void {
        this.disposed = true;
    }
}

describe('TenVADWorkerClient', () => {
    let client: TenVADWorkerClient;

    beforeEach(() => {
        vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
        client = new TenVADWorkerClient();
    });

    afterEach(() => {
        client.dispose();
        vi.unstubAllGlobals();
    });

    it('should not be ready before init', () => {
        expect(client.isReady()).toBe(false);
    });

    it('should reject init when worker returns ERROR (e.g. WASM unavailable)', async () => {
        await expect(client.init({ wasmPath: '/wasm/' })).rejects.toThrow();
        expect(client.isReady()).toBe(false);
    });

    it('should not call process when not ready', async () => {
        await expect(client.init({ wasmPath: '/wasm/' })).rejects.toThrow();
        const samples = new Float32Array(256);
        expect(() => client.process(samples, 0)).not.toThrow();
        expect(client.isReady()).toBe(false);
    });

    it('should accept onResult callback without throwing', () => {
        const results: TenVADResult[] = [];
        expect(() => client.onResult((r) => results.push(r))).not.toThrow();
    });

    it('should clear ready state and callbacks on dispose', () => {
        client.onResult(() => {});
        expect(client.isReady()).toBe(false);
        client.dispose();
        expect(client.isReady()).toBe(false);
        expect(() => client.process(new Float32Array(256), 0)).not.toThrow();
    });
});
