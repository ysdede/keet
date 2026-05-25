import { describe, it, expect } from 'vitest';
import { resampleLinear } from './utils';

describe('resampleLinear', () => {
    it('should return the exact same array if rates match', () => {
        const input = new Float32Array([1, 2, 3]);
        const output = resampleLinear(input, 16000, 16000);

        // Exact identity check to verify no allocation
        expect(output).toBe(input);
    });

    it('should correctly downsample with an integer ratio', () => {
        // Ratio = 2 (e.g., 32kHz to 16kHz)
        const input = new Float32Array([0, 10, 20, 30, 40, 50]);
        const output = resampleLinear(input, 32000, 16000);

        expect(output).toBeInstanceOf(Float32Array);
        expect(output.length).toBe(3);
        // It picks index 0, 2, 4
        expect(output).toEqual(new Float32Array([0, 20, 40]));
    });

    it('should correctly downsample with a fractional ratio using linear interpolation', () => {
        // Ratio = 1.5 (e.g., 24kHz to 16kHz)
        const input = new Float32Array([0, 10, 20, 30, 40, 50]);
        const output = resampleLinear(input, 24000, 16000);

        expect(output.length).toBe(4);

        // i=0 -> srcIndex=0 -> 0
        // i=1 -> srcIndex=1.5 -> input[1]*0.5 + input[2]*0.5 = 10*0.5 + 20*0.5 = 15
        // i=2 -> srcIndex=3.0 -> input[3] = 30
        // i=3 -> srcIndex=4.5 -> input[4]*0.5 + input[5]*0.5 = 40*0.5 + 50*0.5 = 45
        expect(output).toEqual(new Float32Array([0, 15, 30, 45]));
    });

    it('should correctly upsample with linear interpolation', () => {
        // Ratio = 0.5 (e.g., 16kHz to 32kHz)
        const input = new Float32Array([10, 20, 30]);
        const output = resampleLinear(input, 16000, 32000);

        expect(output.length).toBe(6);

        // i=0 -> srcIndex=0 -> 10
        // i=1 -> srcIndex=0.5 -> 10*0.5 + 20*0.5 = 15
        // i=2 -> srcIndex=1.0 -> 20
        // i=3 -> srcIndex=1.5 -> 20*0.5 + 30*0.5 = 25
        // i=4 -> srcIndex=2.0 -> 30
        // i=5 -> srcIndex=2.5 -> 30*0.5 + 30*0.5 = 30 (clamps to end)
        expect(output).toEqual(new Float32Array([10, 15, 20, 25, 30, 30]));
    });

    it('should return an empty array if input is empty', () => {
        const input = new Float32Array([]);
        const output = resampleLinear(input, 48000, 16000);

        expect(output).toBeInstanceOf(Float32Array);
        expect(output.length).toBe(0);
    });

    it('should handle single element arrays when downsampling', () => {
        const input = new Float32Array([42]);
        // Ratio = 2, output length = floor(1 / 2) = 0
        const output = resampleLinear(input, 32000, 16000);

        expect(output.length).toBe(0);
    });

    it('should handle single element arrays when upsampling', () => {
        const input = new Float32Array([42]);
        // Ratio = 0.5, output length = floor(1 / 0.5) = 2
        const output = resampleLinear(input, 16000, 32000);

        expect(output.length).toBe(2);
        expect(output).toEqual(new Float32Array([42, 42]));
    });
});
