import { describe, it, expect } from 'vitest';
import {
  normalizeMelForDisplay,
  MEL_DISPLAY_MIN_DB,
  MEL_DISPLAY_MAX_DB,
  MEL_DISPLAY_DB_RANGE
} from './mel-display';

describe('normalizeMelForDisplay', () => {
  it('maps the minimum boundary to 0', () => {
    expect(normalizeMelForDisplay(MEL_DISPLAY_MIN_DB)).toBe(0);
  });

  it('maps the maximum boundary to 1', () => {
    expect(normalizeMelForDisplay(MEL_DISPLAY_MAX_DB)).toBe(1);
  });

  it('clamps values below the minimum to 0', () => {
    expect(normalizeMelForDisplay(MEL_DISPLAY_MIN_DB - 5)).toBe(0);
  });

  it('clamps values above the maximum to 1', () => {
    expect(normalizeMelForDisplay(MEL_DISPLAY_MAX_DB + 5)).toBe(1);
  });

  it('maps the midpoint to 0.5', () => {
    const midpoint = MEL_DISPLAY_MIN_DB + (MEL_DISPLAY_DB_RANGE / 2);
    expect(normalizeMelForDisplay(midpoint)).toBeCloseTo(0.5);
  });
});
