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
   * Ensures the "group" collection is populated containing non-allocated groups.
   * Uses batch inserts for performance.
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
        await this.dbCollection.group.insertMany(batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await this.dbCollection.group.insertMany(batch);
    }
  }

  /**
   * Ensures the "permission" collection is populated containing non-allocated permissions.
   * Uses batch inserts for performance.
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
        await this.dbCollection.permission.insertMany(batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await this.dbCollection.permission.insertMany(batch);
    }
  }

  /**
   * Initialize: prepopulates groups and permissions if not already done.
   */
  async initialize(): Promise<void> {
    return this.populateGroupsAndPermissions();
  }

  /**
   * This ensures we pre-populate the database collections with groups and permissions ensuring we've got the sequence in order
   * When called multiple times, we skip seeding
   * @returns {Promise<void>}
   */
  async populateGroupsAndPermissions(): Promise<void> {
    const countGroups = this.dbCollection.group.countDocuments(
      {
        gibbonIsAllocated: { $exists: true },
      },
      { limit: 1 }
    );

    const countPermissions = this.dbCollection.permission.countDocuments(
      {
        gibbonIsAllocated: { $exists: true },
      },
      { limit: 1 }
    );

    const [count1, count2] = await Promise.all([countGroups, countPermissions]);

    if ((count1 | count2) !== 0x0) {
      throw new Error(
        `Called populateGroupsAndPermissions, but permissions and groups seem to be populated already`
      );
    }

    await Promise.all([this.populateGroups(), this.populatePermissions()]);
  }
}
