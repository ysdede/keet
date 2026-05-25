import { describe, it, expect } from 'vitest';
import { resampleLinear } from './utils';

describe('resampleLinear', () => {
    it('returns the same array instance if fromRate equals toRate', () => {
        const input = new Float32Array([1, 2, 3]);
        const output = resampleLinear(input, 48000, 48000);
        expect(output).toBe(input);
    });

    it('downsamples with integer ratio correctly (e.g. 48kHz to 24kHz)', () => {
        // ratio = 2
        // srcIndex: 0, 2, 4
        const input = new Float32Array([1, 2, 3, 4, 5]);
        const output = resampleLinear(input, 48000, 24000);
        // expected outputLength = floor(5 / 2) = 2
        // i=0: srcIndex=0 -> 1
        // i=1: srcIndex=2 -> 3
        expect(output).toEqual(new Float32Array([1, 3]));
    });

    it('downsamples with fractional ratio using linear interpolation (e.g. 24kHz to 16kHz)', () => {
        // ratio = 1.5
        const input = new Float32Array([0, 10, 20, 30, 40]);
        const output = resampleLinear(input, 24000, 16000);
        // expected outputLength = floor(5 / 1.5) = floor(3.33) = 3
        // i=0: srcIndex=0 -> 0
        // i=1: srcIndex=1.5 -> (1-0.5)*input[1] + 0.5*input[2] = 0.5*10 + 0.5*20 = 15
        // i=2: srcIndex=3.0 -> input[3] = 30
        expect(output).toEqual(new Float32Array([0, 15, 30]));
    });

    it('upsamples correctly (e.g. 16kHz to 48kHz)', () => {
        // ratio = 1/3
        const input = new Float32Array([10, 20, 30]);
        const output = resampleLinear(input, 16000, 48000);
        // expected outputLength = floor(3 / (1/3)) = 9
        // i=0: src=0 -> 10
        // i=1: src=0.333 -> (1-0.333)*10 + 0.333*20 = 13.333
        // i=2: src=0.666 -> (1-0.666)*10 + 0.666*20 = 16.666
        // i=3: src=1 -> 20
        // i=4: src=1.333 -> (1-0.333)*20 + 0.333*30 = 23.333
        // i=5: src=1.666 -> (1-0.666)*20 + 0.666*30 = 26.666
        // i=6: src=2 -> 30
        // i=7: src=2.333 -> (1-0.333)*30 + 0.333*30 = 30 (since ceil index bounded by input.length-1)
        // i=8: src=2.666 -> (1-0.666)*30 + 0.666*30 = 30

        expect(output.length).toBe(9);
        expect(output[0]).toBeCloseTo(10);
        expect(output[1]).toBeCloseTo(13.333, 2);
        expect(output[2]).toBeCloseTo(16.666, 2);
        expect(output[3]).toBeCloseTo(20);
        expect(output[4]).toBeCloseTo(23.333, 2);
        expect(output[5]).toBeCloseTo(26.666, 2);
        expect(output[6]).toBeCloseTo(30);
        expect(output[7]).toBeCloseTo(30);
        expect(output[8]).toBeCloseTo(30);
    });

    it('handles empty input array', () => {
        const input = new Float32Array([]);
        const output = resampleLinear(input, 48000, 16000);
        expect(output).toEqual(new Float32Array([]));
    });

    it('handles single element input array downsampling', () => {
        const input = new Float32Array([42]);
        const output = resampleLinear(input, 48000, 24000);
        // length = floor(1 / 2) = 0
        expect(output).toEqual(new Float32Array([]));
    });

    it('handles single element input array upsampling', () => {
        const input = new Float32Array([42]);
        const output = resampleLinear(input, 24000, 48000);
        // length = floor(1 / 0.5) = 2
        // i=0: src=0 -> 42
        // i=1: src=0.5 -> 42
        expect(output).toEqual(new Float32Array([42, 42]));
    });
});
