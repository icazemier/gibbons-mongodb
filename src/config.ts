import { cosmiconfig } from 'cosmiconfig';
import { CosmiconfigResult } from 'cosmiconfig/dist/types.js';
import { Config } from './interfaces/config.js';

export class ConfigLoader {
  /**
   * Load config from disk, looks for `.gibbons-mongodbrc` file by default
   * @see For Usage {@link https://github.com/davidtheclark/cosmiconfig}
   *
   * @param {string} [module="gibbons-mongodb"]
   * @param {string} [filepath]
   * @throws {Error} When no config file could be resolved
   *
   * @example
   * ```typescript
   * // Load config from default locations (.gibbons-mongodbrc, package.json, etc.)
   * const config = await ConfigLoader.load();
   *
   * // Load config from specific file
   * const config = await ConfigLoader.load('gibbons-mongodb', './my-config.json');
   * ```
   *
   * @public
   */
  public static async load(
    module = 'gibbons-mongodb',
    filepath?: string
  ): Promise<Config> {
    const explorer = cosmiconfig(module || 'gibbons-mongodb');

    const configResult = (
      filepath ? await explorer.load(filepath) : await explorer.search()
    ) as CosmiconfigResult;

    if (!configResult?.config) {
      throw new Error(
        'Could not load config, execute `npx gibbons-mongodb init`'
      );
    }
    const { config } = configResult;
    return config;
  }
}
