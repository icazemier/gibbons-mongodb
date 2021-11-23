import { Gibbon } from '@icazemier/gibbons';
import { MongoClient, Document } from 'mongodb';
import { GibbonLike } from '../interfaces/index.js';

/**
 * Abstract base class for Gibbon MongoDB models.
 * Provides shared functionality such as the `ensureGibbon` conversion utility
 * and holds the MongoDB client reference and configured byte length.
 */
export abstract class GibbonModel implements Document {
  /**
   * @param mongoClient - Connected MongoDB client instance
   * @param byteLength - Number of bytes for Gibbon bitmasks (default: 256)
   */
  constructor(
    protected mongoClient: MongoClient,
    protected byteLength: number = 256
  ) {}

  /**
   * Initializes the model by binding it to a specific database and collection.
   *
   * @param structure - Database name and collection name to bind to
   */
  abstract initialize(structure: {
    dbName: string;
    collectionName: string;
  }): Promise<void>;

  /**
   * Convenience function which accepts an Array of positions, a Gibbon or Buffer
   * and returns a Gibbon instance with the configured byte length.
   *
   * - If given an `Array<number>`, creates a new Gibbon and sets the positions.
   * - If given a `Buffer`, decodes it and merges into a new Gibbon.
   * - If given a `Gibbon` with matching byte length, returns it as-is.
   * - If given a `Gibbon` with a different byte length, merges it into a new one.
   *
   * @example
   * ```
   * const positions = [1, 4, 6];
   *
   * const gibbon = model.ensureGibbon(positions);
   *
   * gibbon.getPositionsArray(); // returns [1, 4, 6]
   * ```
   *
   * @example
   * ```
   * // A Buffer with 1 byte:
   * const buff = Buffer.from([0x82]); // 1000 0010 (bin)
   *
   * const gibbon = model.ensureGibbon(buff);
   *
   * gibbon.getPositionsArray(); // returns [2, 8]
   * ```
   *
   * @example
   * ```
   * // Create gibbon1 with 2 bytes
   * const gibbon1 = Gibbon.create(2).setPosition(5).setPosition(9);
   *
   * const gibbon2 = model.ensureGibbon(gibbon1);
   *
   * gibbon2.getPositionsArray(); // returns [5, 9]
   * ```
   *
   * @param positions - Gibbon, array of positions, or Buffer to convert
   * @returns A Gibbon instance with the configured byte length
   * @throws TypeError when `positions` is not a Gibbon, Array or Buffer
   */
  ensureGibbon(positions: GibbonLike): Gibbon {
    const { byteLength } = this;
    if (positions instanceof Gibbon) {
      if (positions.arrayBuffer.byteLength === byteLength) {
        return positions;
      }
      return Gibbon.create(byteLength).mergeWithGibbon(positions);
    } else if (Array.isArray(positions)) {
      return Gibbon.create(byteLength).setAllFromPositions(positions);
    } else if (Buffer.isBuffer(positions)) {
      return Gibbon.create(byteLength).mergeWithGibbon(
        Gibbon.decode(positions)
      );
    }
    throw new TypeError('`Gibbon`, `Array<number>` or `Buffer` expected');
  }
}
