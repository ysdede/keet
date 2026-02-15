import { describe, it, expect, beforeEach } from 'vitest';

// Minimal implementation of CircularLayer for testing
class CircularLayer {
    readonly hopSamples: number;
    readonly entryDimension: number;
    readonly maxEntries: number;
    private buffer: Float32Array;
    private globalWriteIndex: number = 0;

    constructor(maxDurationSec: number, sampleRate: number, hopSamples: number, entryDimension: number) {
        this.hopSamples = hopSamples;
        this.entryDimension = entryDimension;
        this.maxEntries = Math.ceil((sampleRate * maxDurationSec) / hopSamples);
        this.buffer = new Float32Array(this.maxEntries * this.entryDimension);
    }

    writeBatch(data: Float32Array, count?: number): void {
        const n = count ?? Math.floor(data.length / this.entryDimension);
        const entriesToWrite = n;
        
        let entriesWritten = 0;
        while (entriesWritten < entriesToWrite) {
            const writePos = this.globalWriteIndex % this.maxEntries;
            const remainingInBuf = this.maxEntries - writePos;
            const chunkEntries = Math.min(entriesToWrite - entriesWritten, remainingInBuf);
            
            const srcStart = entriesWritten * this.entryDimension;
            const srcEnd = (entriesWritten + chunkEntries) * this.entryDimension;
            const dstStart = writePos * this.entryDimension;
            
            this.buffer.set(data.subarray(srcStart, srcEnd), dstStart);
            
            this.globalWriteIndex += chunkEntries;
            entriesWritten += chunkEntries;
        }
    }

    readRange(startSample: number, endSample: number): any {
        if (endSample <= startSample) return null;

        const startEntry = Math.floor(startSample / this.hopSamples);
        const endEntry = Math.ceil(endSample / this.hopSamples);

        const base = Math.max(0, this.globalWriteIndex - this.maxEntries);
        const clampStart = Math.max(startEntry, base);
        const clampEnd = Math.min(endEntry, this.globalWriteIndex);

        if (clampEnd <= clampStart) return null;

        const totalEntries = clampEnd - clampStart;
        const result = new Float32Array(totalEntries * this.entryDimension);

        let entriesRead = 0;
        while (entriesRead < totalEntries) {
            const readIdx = (clampStart + entriesRead) % this.maxEntries;
            const remainingInBuf = this.maxEntries - readIdx;
            const chunkEntries = Math.min(totalEntries - entriesRead, remainingInBuf);
            
            const srcStart = readIdx * this.entryDimension;
            const srcEnd = (readIdx + chunkEntries) * this.entryDimension;
            const dstStart = entriesRead * this.entryDimension;
            
            result.set(this.buffer.subarray(srcStart, srcEnd), dstStart);
            entriesRead += chunkEntries;
        }

        return result;
    }

    getBuffer() { return this.buffer; }
}

describe('CircularLayer Optimization', () => {
    it('correctly handles batch writes with wrap-around', () => {
        const layer = new CircularLayer(1, 100, 1, 1); // 100 entries
        const data = new Float32Array(150);
        for (let i = 0; i < 150; i++) data[i] = i;

        layer.writeBatch(data);
        const buffer = layer.getBuffer();
        
        // After 150 writes into 100 slots, the first 50 slots should have 100-149
        // and the last 50 slots should have 50-99
        expect(buffer[0]).toBe(100);
        expect(buffer[49]).toBe(149);
        expect(buffer[50]).toBe(50);
        expect(buffer[99]).toBe(99);
    });

    it('correctly handles reads with wrap-around', () => {
        const layer = new CircularLayer(1, 100, 1, 1); // 100 entries
        const data = new Float32Array(150);
        for (let i = 0; i < 150; i++) data[i] = i;
        layer.writeBatch(data);

        // Available range is [50, 150)
        const result = layer.readRange(50, 150);
        expect(result.length).toBe(100);
        expect(result[0]).toBe(50);
        expect(result[49]).toBe(99);
        expect(result[50]).toBe(100);
        expect(result[99]).toBe(149);
    });
});
