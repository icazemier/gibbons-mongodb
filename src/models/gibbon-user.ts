import { Gibbon } from '@icazemier/gibbons';
import {
  Binary,
  ClientSession,
  Collection,
  Filter,
  FindCursor,
  FindOneAndUpdateOptions,
} from 'mongodb';
import { IGibbonUser } from '../interfaces/gibbon-user.js';
import { IPermissionsResource } from '../interfaces/permissions-resource.js';
import { GibbonModel } from './gibbon-model.js';
import { GibbonLike } from '../interfaces/gibbon-like.js';

/**
 * Model for managing user documents in MongoDB.
 * Users hold bitwise masks for group memberships and aggregated permissions.
 */
export class GibbonUser extends GibbonModel {
  protected dbCollection!: Collection<IGibbonUser>;

  /** {@inheritDoc GibbonModel.initialize} */
  async initialize(dbName: string, collectionName: string): Promise<void> {
    this.dbCollection = this.mongoClient.db(dbName).collection(collectionName);
  }

  /**
   * Maps the `permissionsGibbon` and `groupsGibbon` fields of a user document
   * from MongoDB Binary to Gibbon instances.
   *
   * @example
   * ```
   * const user = {
   *    _id: ObjectId,
   *    permissionsGibbon: Binary,
   *    groupsGibbon: Binary
   * };
   *
   * const transformed = GibbonUser.mapPermissionsBinaryToGibbon(user);
   * // transformed.permissionsGibbon is now a Gibbon instance
   * // transformed.groupsGibbon is now a Gibbon instance
   * ```
   *
   * @param user - User document with Binary gibbon fields
   * @returns User document with gibbon fields decoded as Gibbon instances
   */
  protected static mapPermissionsBinaryToGibbon<T extends IGibbonUser>(
    user: T
  ): IGibbonUser {
    const permissionBuffer = Buffer.from(
      (user.permissionsGibbon as Binary).buffer
    );
    const groupBuffer = Buffer.from((user.groupsGibbon as Binary).buffer);

    return {
      ...user,
      ...{
        permissionsGibbon: Gibbon.decode(permissionBuffer),
        groupsGibbon: Gibbon.decode(groupBuffer),
      },
    };
  }

  /**
   * Finds users that have any of the given permissions set.
   *
   * @param permissions - Permission positions to search for
   * @returns A MongoDB FindCursor of matching user documents
   */
  findByPermissions(permissions: GibbonLike): FindCursor<IGibbonUser> {
    const $bitsAnySet = new Binary(this.ensureGibbon(permissions).toBuffer());

    const filter = {
      permissionsGibbon: {
        $bitsAnySet,
      },
    };

    return this.dbCollection
      .find(filter)
      .map((user) => GibbonUser.mapPermissionsBinaryToGibbon(user));
  }

  /**
   * Finds users that are subscribed to any of the given groups.
   *
   * @param groups - Group positions to search for
   * @returns A MongoDB FindCursor of matching user documents
   */
  findByGroups(groups: GibbonLike): FindCursor<IGibbonUser> {
    const $bitsAnySet = new Binary(this.ensureGibbon(groups).toBuffer());

    const filter = {
      groupsGibbon: {
        $bitsAnySet,
      },
    };

    return this.dbCollection
      .find(filter)
      .map((user) => GibbonUser.mapPermissionsBinaryToGibbon(user));
  }

  /**
   * Finds all users that have any of the given permissions set,
   * and unsets those permission bits.
   *
   * @param permissions - Permission positions to unset from users
   * @param session - Optional MongoDB client session for transactional operations
   */
  async unsetPermissions(
    permissions: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    const permissionsToUnset = this.ensureGibbon(permissions);
    const permissionPositionsToUnset = permissionsToUnset.getPositionsArray();

    // Loop through all users check if there are any positions, then
    // be sure to unset these permissions
    const $bitsAnySet = new Binary(permissionsToUnset.toBuffer());
    const userFilter = {
      permissionsGibbon: {
        $bitsAnySet,
      },
    };

    const userCursor = this.dbCollection.find(userFilter, { session });

    for await (const user of userCursor) {
      const permissionBuffer = Buffer.from(
        (user.permissionsGibbon as Binary).buffer
      );

      const gibbon = Gibbon.decode(permissionBuffer).unsetAllFromPositions(
        permissionPositionsToUnset
      );

      // Update permissions in this group
      await this.dbCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            permissionsGibbon: gibbon.toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }

  /**
   * Finds users subscribed to the given groups, unsets those group bits,
   * and recalculates their permissions from remaining group memberships.
   *
   * @param groups - Group positions to unset from users
   * @param permissionsResource - Resource used to recalculate permissions from remaining groups
   * @param session - Optional MongoDB client session for transactional operations
   */
  async unsetGroups(
    groups: GibbonLike,
    permissionsResource: IPermissionsResource,
    session?: ClientSession
  ): Promise<void> {
    const groupsToUnset = this.ensureGibbon(groups);
    const groupsToDeallocateBinary = new Binary(groupsToUnset.toBuffer());
    const positionsToDeallocate = groupsToUnset.getPositionsArray();

    const filter = {
      groupsGibbon: {
        $bitsAnySet: groupsToDeallocateBinary,
      },
    };

    const userCursor = this.dbCollection.find(filter, { session });

    for await (const user of userCursor) {
      const { groupsGibbon: groupsGibbonBinary, _id } = user;
      const buffer = Buffer.from((groupsGibbonBinary as Binary).buffer);

      // Unset bit positions
      const groupsGibbon = Gibbon.decode(buffer).unsetAllFromPositions(
        positionsToDeallocate
      );

      // We need to determine permissions from
      // group subscriptions for this user
      // Delegate this to our `permissionsResource`
      const permissionGibbon =
        await permissionsResource.getPermissionsGibbonForGroups(groupsGibbon);

      // Update groups and corresponding permissions for this user
      await this.dbCollection.updateOne(
        { _id },
        {
          $set: {
            groupsGibbon: groupsGibbon.toBuffer(),
            permissionsGibbon: permissionGibbon.toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }

  /**
   * Finds users matching the filter, merges the given groups and permissions
   * into their existing memberships.
   *
   * @param filter - MongoDB filter to select users
   * @param groups - Gibbon representing groups to subscribe
   * @param permissions - Gibbon representing permissions to subscribe
   * @param session - Optional MongoDB client session for transactional operations
   */
  async subscribeToGroupsAndPermissions(
    filter: Filter<IGibbonUser>,
    groups: Gibbon,
    permissions: Gibbon,
    session?: ClientSession
  ): Promise<void> {
    const userCursor = this.dbCollection.find(filter, { session });

    for await (const user of userCursor) {
      const groupsBuffer = Buffer.from((user.groupsGibbon as Binary).buffer);
      const permissionsBuffer = Buffer.from(
        (user.permissionsGibbon as Binary).buffer
      );

      await this.dbCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            groupsGibbon: Gibbon.decode(groupsBuffer)
              .mergeWithGibbon(groups)
              .toBuffer(),
            permissionsGibbon: Gibbon.decode(permissionsBuffer)
              .mergeWithGibbon(permissions)
              .toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }

  /**
   * Finds all users subscribed to the given groups and merges the given
   * permissions into their existing permissions.
   *
   * @param groups - Gibbon representing groups to match users against
   * @param permissions - Gibbon representing permissions to subscribe
   * @param session - Optional MongoDB client session for transactional operations
   */
  async subscribeToPermissionsForGroups(
    groups: Gibbon,
    permissions: Gibbon,
    session?: ClientSession
  ): Promise<void> {
    const filter = {
      groupsGibbon: {
        $bitsAnySet: new Binary(groups.toBuffer()),
      },
    };

    const userCursor = this.dbCollection.find(filter, {
      projection: {
        permissionsGibbon: 1,
      },
      session,
    });

    for await (const user of userCursor) {
      const { _id, permissionsGibbon } = user;
      const permissionsBuffer = Buffer.from(
        (permissionsGibbon as Binary).buffer
      );

      await this.dbCollection.updateOne(
        { _id },
        {
          $set: {
            permissionsGibbon: Gibbon.decode(permissionsBuffer)
              .mergeWithGibbon(permissions)
              .toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }

  /**
   * Updates custom metadata on a user document.
   * Does not modify groupsGibbon or permissionsGibbon.
   *
   * @param filter - MongoDB filter to select the user(s) to update
   * @param data - Key-value pairs to set on the user document(s)
   * @param session - Optional MongoDB client session for transactional operations
   * @returns The updated user document, or null if no user was found
   */
  public async updateMetadata<T extends Record<string, unknown>>(
    filter: Filter<IGibbonUser>,
    data: T,
    session?: ClientSession
  ): Promise<IGibbonUser | null> {
    const options: FindOneAndUpdateOptions = {
      returnDocument: 'after',
      session,
    };
    const result = await this.dbCollection.findOneAndUpdate(
      filter,
      { $set: data as Partial<IGibbonUser> },
      options
    );
    return result
      ? GibbonUser.mapPermissionsBinaryToGibbon(result as IGibbonUser)
      : null;
  }

  /**
   * Creates a new user document with empty group and permission gibbons.
   *
   * @param data - Additional data to store on the user document (e.g. name, email)
   * @param groupByteLength - Byte length for the groups Gibbon
   * @param permissionByteLength - Byte length for the permissions Gibbon
   * @param session - Optional MongoDB client session for transactional operations
   * @returns The newly created user document
   * @throws Error when the user could not be inserted
   */
  /**
   * Resizes the `permissionsGibbon` field in every user document
   * to the given byte length.
   *
   * @param newByteLength - Target byte length for permission gibbons
   * @param session - Optional MongoDB client session for transactional operations
   */
  async resizePermissions(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const cursor = this.dbCollection.find({}, { session });
    for await (const user of cursor) {
      const resized = GibbonUser.resizeGibbon(
        user.permissionsGibbon as Binary,
        newByteLength
      );
      await this.dbCollection.updateOne(
        { _id: user._id },
        { $set: { permissionsGibbon: resized } },
        { session }
      );
    }
    await cursor.close();
  }

  /**
   * Resizes the `groupsGibbon` field in every user document
   * to the given byte length.
   *
   * @param newByteLength - Target byte length for group gibbons
   * @param session - Optional MongoDB client session for transactional operations
   */
  async resizeGroups(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const cursor = this.dbCollection.find({}, { session });
    for await (const user of cursor) {
      const resized = GibbonUser.resizeGibbon(
        user.groupsGibbon as Binary,
        newByteLength
      );
      await this.dbCollection.updateOne(
        { _id: user._id },
        { $set: { groupsGibbon: resized } },
        { session }
      );
    }
    await cursor.close();
  }

  async create<T>(
    data: T,
    groupByteLength: number,
    permissionByteLength: number,
    session?: ClientSession
  ): Promise<IGibbonUser> {
    const doc = {
      ...data,
      groupsGibbon: Gibbon.create(groupByteLength).toBuffer(),
      permissionsGibbon: Gibbon.create(permissionByteLength).toBuffer(),
    };
    const result = await this.dbCollection.insertOne(
      doc as unknown as IGibbonUser,
      { session }
    );
    const user = await this.dbCollection.findOne(
      { _id: result.insertedId },
      { session }
    );
    if (!user) throw new Error('Failed to create user');
    return GibbonUser.mapPermissionsBinaryToGibbon(user);
  }

  /**
   * Remove user(s) matching the given filter
   *
   * @param session - Optional MongoDB client session for transactional operations
   */
  async remove(
    filter: Filter<IGibbonUser>,
    session?: ClientSession
  ): Promise<number> {
    const result = await this.dbCollection.deleteMany(filter, { session });
    return result.deletedCount;
  }

  /**
   * Find users by arbitrary MongoDB filter
   */
  findByFilter(filter: Filter<IGibbonUser>): FindCursor<IGibbonUser> {
    return this.dbCollection
      .find(filter)
      .map((user) => GibbonUser.mapPermissionsBinaryToGibbon(user));
  }

  /**
   * Unsubscribe users matching filter from specific groups,
   * then recalculate their permissions from remaining groups
   *
   * @param session - Optional MongoDB client session for transactional operations
   */
  async unsubscribeFromGroups(
    filter: Filter<IGibbonUser>,
    groups: Gibbon,
    permissionsResource: IPermissionsResource,
    session?: ClientSession
  ): Promise<void> {
    const groupPositionsToUnset = groups.getPositionsArray();
    const groupsBinary = new Binary(groups.toBuffer());

    // Combine user filter with groups membership filter
    const combinedFilter = {
      ...filter,
      groupsGibbon: { $bitsAnySet: groupsBinary },
    } as Filter<IGibbonUser>;

    const userCursor = this.dbCollection.find(combinedFilter, { session });

    for await (const user of userCursor) {
      const { _id } = user;
      const groupBuffer = Buffer.from((user.groupsGibbon as Binary).buffer);

      // Unset group positions
      const groupsGibbon = Gibbon.decode(groupBuffer).unsetAllFromPositions(
        groupPositionsToUnset
      );

      // Recalculate permissions from remaining groups
      const permissionsGibbon =
        await permissionsResource.getPermissionsGibbonForGroups(groupsGibbon);

      await this.dbCollection.updateOne(
        { _id },
        {
          $set: {
            groupsGibbon: groupsGibbon.toBuffer(),
            permissionsGibbon: permissionsGibbon.toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }

  /**
   * Recalculate permissions for users matching the filter
   * based on their current group memberships
   *
   * @param session - Optional MongoDB client session for transactional operations
   */
  async recalculatePermissions(
    filter: Filter<IGibbonUser>,
    permissionsResource: IPermissionsResource,
    session?: ClientSession
  ): Promise<void> {
    const userCursor = this.dbCollection.find(filter, { session });

    for await (const user of userCursor) {
      const { _id } = user;
      const groupBuffer = Buffer.from((user.groupsGibbon as Binary).buffer);
      const groupsGibbon = Gibbon.decode(groupBuffer);

      const permissionsGibbon =
        await permissionsResource.getPermissionsGibbonForGroups(groupsGibbon);

      await this.dbCollection.updateOne(
        { _id },
        {
          $set: {
            permissionsGibbon: permissionsGibbon.toBuffer(),
          },
        },
        { session }
      );
    }
    await userCursor.close();
  }
}
