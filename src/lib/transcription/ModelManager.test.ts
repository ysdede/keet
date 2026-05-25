import { describe, expect, it } from 'vitest';
import { ModelManager } from './ModelManager';

describe('ModelManager', () => {
  it('encodes slash revisions in direct model asset fallback URLs', () => {
    const manager = new ModelManager() as any;
    const assets = manager._buildDirectModelAssets(
      'parakeet-tdt-0.6b-v3',
      'feat/fp16-canonical-v3',
      'webgpu',
      'fp16',
      'int8',
      () => ({ repoId: 'ysdede/parakeet-tdt-0.6b-v3-onnx' }),
    );

    expect(assets.urls.encoderUrl).toContain('/resolve/feat%2Ffp16-canonical-v3/');
    expect(assets.urls.decoderUrl).toContain('/resolve/feat%2Ffp16-canonical-v3/');
    expect(assets.urls.tokenizerUrl).toContain('/resolve/feat%2Ffp16-canonical-v3/');
  });
});
