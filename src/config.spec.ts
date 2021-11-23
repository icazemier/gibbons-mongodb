import { describe, expect, it } from 'vitest';
import { ConfigLoader } from './config.js';

describe('ConfigLoader', () => {
  it('Load sample config', async () => {
    const config = await ConfigLoader.load('gibbons-mongodb-sample');
    expect(config).toBeTruthy();
  });

  it('Load faulty config', async () => {
    await expect(
      ConfigLoader.load('gibbons-mongodb-sampleeeee')
    ).rejects.toThrow(
      'Could not load config, execute `npx gibbons-mongodb init`'
    );
  });
});
