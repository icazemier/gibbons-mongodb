import { Gibbon } from "@icazemier/gibbons";
import { MongoClient, Document } from "mongodb";
import { Config } from "interfaces/config.js";

export abstract class GibbonModel implements Document {
    static byteLength = 256;

    constructor(protected mongoClient: MongoClient, protected config: Config) {}
    /**
     * Convenience function which accepts an Array of positions, a Gibbon or Buffer
     * In case of an Array it creates a Gibbon
     * It also ensures the given bytelength is applied when creating a Gibbon
     *
     * @example
     * ```
     * const byteLength = 10;
     * const positions = [1, 4, 6];
     *
     * const gibbon = MongoDbAdapter.ensureGibbon(positions, byteLength);
     *
     * gibbon.getPosistionArray(); // returns [1, 4, 6] (where gibbon takes up 10 bytes)
     *
     * ```
     *
     * @example
     *
     * ```
     * const byteLength = 2;
     *
     * // A Buffer with 1 byte:
     * const buff = Buffer.from([0x82]); // 1000 0010 (bin)
     *
     * const gibbon = MongoDbAdapter.ensureGibbon(buff, byteLength);
     *
     * gibbon.getPosistionArray(); // returns [2, 8] (where gibbon takes up 2 bytes)
     *
     * ```
     *
     * @example
     *
     * ```
     * const byteLength = 3;
     *
     * // Create gibbon1 with 2 bytes
     * const gibbon1 = Gibbon.create(2).setPosition(5).setPosition(9);
     *
     * const gibbon2 = MongoDbAdapter.ensureGibbon(gibbon1, byteLength);
     *
     * gibbon2.getPosistionArray(); // returns [2, 5, 9] (where gibbon2 takes up 3 bytes)
     *
     *
     * ```
     * @throws TypeError - just in case, when positions is not of the right type
     */
    static ensureGibbon(
        positions: Gibbon | Array<number> | Buffer,
        byteLength: number
    ): Gibbon {
        if (positions instanceof Gibbon) {
            return Gibbon.create(byteLength).mergeWithGibbon(positions);
        } else if (Array.isArray(positions)) {
            return Gibbon.create(byteLength).setAllFromPositions(positions);
        } else if (Buffer.isBuffer(positions)) {
            return Gibbon.create(byteLength).mergeWithGibbon(
                Gibbon.decode(positions)
            );
        }
        throw new TypeError("`Gibbon`, `Array<number>` or `Buffer` expected");
    }
}
