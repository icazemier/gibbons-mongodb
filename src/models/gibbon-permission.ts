import {
  ClientSession,
  Collection,
  FindCursor,
  FindOneAndUpdateOptions,
  MongoClient,
} from 'mongodb';
import { Config } from '../interfaces/config.js';
import { IGibbonPermission } from '../interfaces/gibbon-permission.js';
import { GibbonModel } from './gibbon-model.js';
import { GibbonLike } from '../interfaces/index.js';

/**
 * Model for managing permission documents in MongoDB.
 * Permissions are pre-populated slots that can be allocated and assigned to groups.
 */
export class GibbonPermission extends GibbonModel {
  protected dbCollection!: Collection<IGibbonPermission>;

  /**
   * @param mongoClient - Connected MongoDB client instance
   * @param config - Configuration containing permission byte length
   */
  constructor(mongoClient: MongoClient, config: Config) {
    const { permissionByteLength } = config;
    super(mongoClient, permissionByteLength);
  }

  /** {@inheritDoc GibbonModel.initialize} */
  async initialize(dbName: string, collectionName: string): Promise<void> {
    this.dbCollection = this.mongoClient.db(dbName).collection(collectionName);
  }

  /**
   * Allocates a new permission with any desirable document structure.
   * Searches for the first available non-allocated permission, allocates it,
   * and stores additional given data.
   *
   * @param data - Additional data to store on the permission document (e.g. name, description)
   * @param session - Optional MongoDB client session for transactional operations
   * @returns The newly allocated permission document
   * @throws Error when all permission slots are already allocated
   */
  async allocate<T>(
    data: T,
    session?: ClientSession
  ): Promise<IGibbonPermission> {
    // Query for a non-allocated permission
    const filter = {
      gibbonIsAllocated: false,
    };
    // Sort, get one from the beginning
    const options = {
      returnDocument: 'after',
      sort: ['gibbonPermissionPosition', 1],
      session,
    } as FindOneAndUpdateOptions;
    // Prepare an update, ensure we allocate
    const update = {
      $set: {
        ...data,
        gibbonIsAllocated: true,
      },
    };
    const permission = await this.dbCollection.findOneAndUpdate(
      filter,
      update,
      options
    );
    if (!permission) {
      throw new Error(
        'Not able to allocate permission, seems all permissions are allocated'
      );
    }
    return permission;
  }

  /**
   * Deallocates permission(s) by resetting them to their default (non-allocated) state.
   * This clears any custom fields and marks the permission slots as available for re-allocation.
   *
   * Note: Removing permissions from groups and users is handled by the facade.
   *
   * @param permissions - Permission positions to deallocate
   * @param session - Optional MongoDB client session for transactional operations
   */
  async deallocate(
    permissions: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    // First get the permissions themselves in a cursor
    const $in = this.ensureGibbon(permissions).getPositionsArray();
    const permissionCursor = this.dbCollection.find(
      {
        gibbonPermissionPosition: {
          $in,
        },
      },
      { session }
    );

    for await (const permission of permissionCursor) {
      // Fetch position as reference to update later
      const { gibbonPermissionPosition } = permission;
      // Prepare to reset values to defaults (removing additional fields)
      await this.dbCollection.replaceOne(
        {
          gibbonPermissionPosition,
        },
        {
          gibbonPermissionPosition,
          gibbonIsAllocated: false,
        },
        { session }
      );
    }
    await permissionCursor.close();
  }

  /**
   * Validates whether the given permissions are allocated (or non-allocated) in the database.
   *
   * @param permissions - Permission positions to validate
   * @param allocated - When `true` (default), checks that permissions are allocated; when `false`, checks they are not
   * @param session - Optional MongoDB client session for transactional operations
   * @returns `true` if all given permission positions match the expected allocation state
   */
  public async validate(
    permissions: GibbonLike,
    allocated = true,
    session?: ClientSession
  ): Promise<boolean> {
    const permissionPositions =
      this.ensureGibbon(permissions).getPositionsArray();

    const filter = {
      gibbonPermissionPosition: {
        $in: permissionPositions,
      },
      gibbonIsAllocated: allocated ? true : { $ne: true },
    };

    const count = await this.dbCollection.countDocuments(filter, { session });
    return count === permissionPositions.length;
  }

  /**
   * Finds permission documents matching the given positions.
   *
   * @param permissions - Permission positions to retrieve
   * @returns A MongoDB FindCursor of matching permission documents
   */
  public find(permissions: GibbonLike): FindCursor<IGibbonPermission> {
    const filter = {
      gibbonPermissionPosition: {
        $in: this.ensureGibbon(permissions).getPositionsArray(),
      },
    };
    return this.dbCollection.find(filter);
  }

  /**
   * Returns a cursor over all allocated permission documents.
   *
   * @returns A MongoDB FindCursor of all allocated permission documents
   */
  public findAllocated(): FindCursor<IGibbonPermission> {
    return this.dbCollection.find({ gibbonIsAllocated: true });
  }

  /**
   * Updates custom metadata on an allocated permission (e.g. name, description).
   * Does not modify `gibbonPermissionPosition` or `gibbonIsAllocated`.
   *
   * @param permissionPosition - The position of the permission to update
   * @param data - Key-value pairs to set on the permission document
   * @param session - Optional MongoDB client session for transactional operations
   * @returns The updated permission document, or `null` if no allocated permission was found at that position
   */
  public async updateMetadata<T extends Record<string, unknown>>(
    permissionPosition: number,
    data: T,
    session?: ClientSession
  ): Promise<IGibbonPermission | null> {
    const options: FindOneAndUpdateOptions = {
      returnDocument: 'after',
      session,
    };
    return this.dbCollection.findOneAndUpdate(
      { gibbonPermissionPosition: permissionPosition, gibbonIsAllocated: true },
      { $set: data as Partial<IGibbonPermission> },
      options
    );
  }
}
