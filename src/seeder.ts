import { MongoClient } from 'mongodb';
import { Gibbon } from '@icazemier/gibbons';
import {
  Config,
  DbCollection,
  IGibbonGroup,
  IGibbonPermission,
  IGibbonUser,
} from './interfaces/index.js';

const BATCH_SIZE = 1000;

/**
 * This class is meant to be used when one needs to prepare the Mongo Database with groups and permissions
 *
 * @example
 * ```typescript
 * import { MongoClient } from 'mongodb';
 * import { MongoDbSeeder } from '@icazemier/gibbons-mongodb';
 *
 * const mongoClient = await MongoClient.connect('mongodb://localhost:27017');
 * const config = {
 *   dbName: 'mydb',
 *   permissionByteLength: 256,
 *   groupByteLength: 256,
 *   mongoDbMutationConcurrency: 10,
 *   dbStructure: {
 *     user: { collectionName: 'users' },
 *     group: { collectionName: 'groups' },
 *     permission: { collectionName: 'permissions' }
 *   }
 * };
 *
 * const seeder = new MongoDbSeeder(mongoClient, config);
 * await seeder.initialize();
 * // Database now contains 2048 groups and 2048 permissions ready for allocation
 * ```
 *
 * @class MongoDbSeeder
 */
export class MongoDbSeeder {
  public readonly config: Config;
  public readonly dbCollection!: DbCollection;

  constructor(mongoClient: MongoClient, config: Config) {
    const { dbName, dbStructure } = config;
    const db = mongoClient.db(dbName);

    const user = db.collection<IGibbonUser>(dbStructure.user.collectionName);
    const group = db.collection<IGibbonGroup>(dbStructure.group.collectionName);
    const permission = db.collection<IGibbonPermission>(
      dbStructure.permission.collectionName
    );

    this.config = config;
    this.dbCollection = { user, group, permission };
  }

  /**
   * Creates unique indexes on position fields to prevent duplicate slots.
   * @private
   */
  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.dbCollection.group.createIndex(
        { gibbonGroupPosition: 1 },
        { unique: true }
      ),
      this.dbCollection.permission.createIndex(
        { gibbonPermissionPosition: 1 },
        { unique: true }
      ),
    ]);
  }

  /**
   * Populates the "group" collection with non-allocated group slots.
   * Skips positions that already exist (via unique index).
   * @private
   */
  protected async populateGroups(): Promise<void> {
    const total = this.config.groupByteLength * 8;
    const batch: IGibbonGroup[] = [];

    for (let seq = 1; seq <= total; seq++) {
      batch.push({
        permissionsGibbon: Gibbon.create(
          this.config.groupByteLength
        ).toBuffer(),
        gibbonGroupPosition: seq,
        gibbonIsAllocated: false,
      });

      if (batch.length >= BATCH_SIZE) {
        await this.dbCollection.group.insertMany(batch, { ordered: false }).catch(
          (err) => this.ignoreDuplicateKeyErrors(err)
        );
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await this.dbCollection.group.insertMany(batch, { ordered: false }).catch(
        (err) => this.ignoreDuplicateKeyErrors(err)
      );
    }
  }

  /**
   * Populates the "permission" collection with non-allocated permission slots.
   * Skips positions that already exist (via unique index).
   * @private
   */
  private async populatePermissions(): Promise<void> {
    const total = this.config.permissionByteLength * 8;
    const batch: IGibbonPermission[] = [];

    for (let seq = 1; seq <= total; seq++) {
      batch.push({
        gibbonPermissionPosition: seq,
        gibbonIsAllocated: false,
      });

      if (batch.length >= BATCH_SIZE) {
        await this.dbCollection.permission.insertMany(batch, { ordered: false }).catch(
          (err) => this.ignoreDuplicateKeyErrors(err)
        );
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await this.dbCollection.permission.insertMany(batch, { ordered: false }).catch(
        (err) => this.ignoreDuplicateKeyErrors(err)
      );
    }
  }

  /**
   * Re-throws any error that is not a MongoDB duplicate key error (code 11000).
   * Used with `insertMany({ ordered: false })` so existing documents are silently skipped
   * while genuine failures still surface.
   * @private
   */
  private ignoreDuplicateKeyErrors(err: unknown): void {
    const code = (err as { code?: number }).code;
    if (code !== 11000) {
      throw err;
    }
  }

  /**
   * Initialize: creates unique indexes and populates groups/permissions
   * if not already done. Safe to call multiple times — existing data is never overwritten.
   */
  async initialize(): Promise<void> {
    await this.ensureIndexes();
    await Promise.all([this.populateGroups(), this.populatePermissions()]);
  }

  /**
   * @deprecated Use {@link initialize} instead. This method throws when data
   * already exists; `initialize()` is idempotent and safe to call repeatedly.
   */
  async populateGroupsAndPermissions(): Promise<void> {
    const [countGroups, countPermissions] = await Promise.all([
      this.dbCollection.group.countDocuments(
        { gibbonIsAllocated: { $exists: true } },
        { limit: 1 }
      ),
      this.dbCollection.permission.countDocuments(
        { gibbonIsAllocated: { $exists: true } },
        { limit: 1 }
      ),
    ]);

    if (countGroups > 0 || countPermissions > 0) {
      throw new Error(
        `Called populateGroupsAndPermissions, but permissions and groups seem to be populated already`
      );
    }

    await this.ensureIndexes();
    await Promise.all([this.populateGroups(), this.populatePermissions()]);
  }
}
