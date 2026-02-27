import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { TranscriptionWorkerClient } from './TranscriptionWorkerClient';

// Mock Worker class
class MockWorker {
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
    onerror: ((this: Worker, ev: ErrorEvent) => any) | null = null;
    static throwOnPostMessage = false;

    constructor(stringUrl: string | URL, options?: WorkerOptions) {}

    postMessage(data: any) {
        if (MockWorker.throwOnPostMessage) {
            throw new Error('postMessage failed');
        }
        // Simulate async response
        setTimeout(() => {
            if (this.onmessage) {
                const { type, id } = data;

                let responsePayload: any = undefined;

                // Simulate specific responses based on request type
                if (type === 'INIT_SERVICE') {
                    // void response
                } else if (type === 'PROCESS_CHUNK') {
                    responsePayload = {
                        chunkText: 'test',
                        text: 'test',
                        words: [],
                        totalDuration: 1.0,
                        isFinal: false
                    };
                } else if (type === 'LOAD_LOCAL_MODEL') {
                    // void response
                }

                // In the real worker, success messages usually allow the promise to resolve with the payload
                // The client handles: if type === 'ERROR' reject, else resolve(payload)

                // For void responses, payload is undefined.
                // For data responses, payload is the data.

                // The client handleMessage looks for id matching pending promise.
                // It resolves with payload.

                this.onmessage({
                    data: {
                        type: 'SUCCESS', // Type doesn't matter for promise resolution, only ID matters unless it is ERROR
                        id,
                        payload: responsePayload
                    }
                } as MessageEvent);
            }
        }, 0);
    }

    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
}

const originalWorker = globalThis.Worker;

describe('TranscriptionWorkerClient', () => {
    let client: TranscriptionWorkerClient;

    beforeAll(() => {
        vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    });

    beforeEach(() => {
        MockWorker.throwOnPostMessage = false;
        client = new TranscriptionWorkerClient();
    });

    afterEach(() => {
        client.dispose();
    });

    afterAll(() => {
        if (originalWorker) {
            vi.stubGlobal('Worker', originalWorker);
        } else {
            vi.unstubAllGlobals();
        }
    });

    it('should initialize service', async () => {
        const config = { sampleRate: 16000 };
        await expect(client.initService(config)).resolves.toBeUndefined();
    });

    it('should process audio chunk', async () => {
        const audio = new Float32Array(16000);
        const result = await client.processChunk(audio);
        expect(result).toEqual({
            chunkText: 'test',
            text: 'test',
            words: [],
            totalDuration: 1.0,
            isFinal: false
        });
    });

    it('should load local model files', async () => {
        const file = new File([''], 'model.onnx');
        await expect(client.initLocalModel([file])).resolves.toBeUndefined();
    });

    it('should reject pending requests when disposed', async () => {
        const pending = client.initService({ sampleRate: 16000 });
        client.dispose();
        await expect(pending).rejects.toThrow('TranscriptionWorkerClient disposed');
    });

    it('should reject requests after disposal', async () => {
        client.dispose();
        await expect(client.initService({ sampleRate: 16000 })).rejects.toThrow('TranscriptionWorkerClient disposed');
    });

    it('should reject and cleanup pending map when postMessage throws', async () => {
        MockWorker.throwOnPostMessage = true;
        await expect(client.initService({ sampleRate: 16000 })).rejects.toThrow('postMessage failed');
        expect((client as any).pendingPromises.size).toBe(0);
    });
});
