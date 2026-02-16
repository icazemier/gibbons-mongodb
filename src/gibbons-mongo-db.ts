import {
  Binary,
  ClientSession,
  Filter,
  FindCursor,
  MongoClient,
} from 'mongodb';

import { GibbonUser, GibbonGroup, GibbonPermission } from './models/index.js';
import { Gibbon } from '@icazemier/gibbons';
import { IPermissionsResource } from './interfaces/permissions-resource.js';
import { GibbonLike } from './interfaces/gibbon-like.js';
import { IGibbonGroup } from './interfaces/gibbon-group.js';
import { IGibbonUser } from './interfaces/gibbon-user.js';
import { Config } from './interfaces/config.js';
import { IGibbonPermission } from './interfaces/gibbon-permission.js';
import { withTransaction } from './utils.js';
import { MongoDbSeeder } from './seeder.js';

/**
 * Main class which does all the "heavy" lifting against MongoDB for managing
 * users, groups, and permissions with bitwise efficiency using Gibbons.
 *
 * All multi-step operations are wrapped in MongoDB transactions
 * for atomicity and consistency.
 *
 * @example Complete workflow
 * ```typescript
 * import { GibbonsMongoDb, ConfigLoader } from '@icazemier/gibbons-mongodb';
 *
 * // Load config and initialize
 * const config = await ConfigLoader.load();
 * const gibbonsDb = new GibbonsMongoDb('mongodb://localhost:27017', config);
 * await gibbonsDb.initialize();
 *
 * // Allocate permissions
 * const editPerm = await gibbonsDb.allocatePermission({ name: 'posts.edit' });
 * const deletePerm = await gibbonsDb.allocatePermission({ name: 'posts.delete' });
 *
 * // Allocate groups and assign permissions
 * const adminGroup = await gibbonsDb.allocateGroup({ name: 'Admins' });
 * await gibbonsDb.subscribePermissionsToGroups(
 *   [adminGroup.gibbonGroupPosition],
 *   [editPerm.gibbonPermissionPosition, deletePerm.gibbonPermissionPosition]
 * );
 *
 * // Create user and assign to group
 * const user = await gibbonsDb.createUser({ name: 'John', email: 'john@example.com' });
 * await gibbonsDb.subscribeUsersToGroups(
 *   { _id: user._id },
 *   [adminGroup.gibbonGroupPosition]
 * );
 *
 * // Validate permissions
 * const hasEdit = gibbonsDb.validateUserPermissionsForAnyPermissions(
 *   user.permissionsGibbon,
 *   [editPerm.gibbonPermissionPosition]
 * );
 * console.log('User can edit:', hasEdit); // true
 * ```
 */
export class GibbonsMongoDb implements IPermissionsResource {
  protected gibbonGroup!: GibbonGroup;
  protected gibbonPermission!: GibbonPermission;
  protected gibbonUser!: GibbonUser;
  protected mongoClient!: MongoClient;
  private readonly mongoClientOrUri: MongoClient | string;

  /**
   * Creates a new GibbonsMongoDb instance.
   *
   * @param mongoClientOrUri - A MongoDB connection URI **or** an existing connected `MongoClient`.
   *   When a `MongoClient` is provided the adapter re-uses it (no extra connection is created),
   *   so sessions started from that client work with all facade methods.
   * @param config - Configuration containing database structure and byte lengths
   *
   * @example Using a URI (adapter creates its own client)
   * ```typescript
   * const gibbonsDb = new GibbonsMongoDb('mongodb://localhost:27017', config);
   * await gibbonsDb.initialize();
   * ```
   *
   * @example Using an existing MongoClient (shared connection)
   * ```typescript
   * const client = await MongoClient.connect('mongodb://localhost:27017');
   * const gibbonsDb = new GibbonsMongoDb(client, config);
   * await gibbonsDb.initialize();
   *
   * // Sessions from `client` work directly
   * await withTransaction(client, async (session) => {
   *   await gibbonsDb.allocatePermission({ name: 'edit' }, session);
   *   await gibbonsDb.allocateGroup({ name: 'admins' }, session);
   * });
   * ```
   */
  constructor(
    mongoClientOrUri: MongoClient | string,
    protected config: Config
  ) {
    this.mongoClientOrUri = mongoClientOrUri;
  }

  /**
   * Initialize the GibbonsMongoDb instance by connecting to MongoDB
   * and setting up the collections for users, groups, and permissions.
   *
   * Must be called before using any other methods.
   *
   * @returns Promise that resolves when initialization is complete
   *
   * @example
   * ```typescript
   * const gibbonsDb = new GibbonsMongoDb('mongodb://localhost:27017', config);
   * await gibbonsDb.initialize();
   * // Now ready to use
   * ```
   */
  /**
   * Returns the underlying MongoClient used by this instance.
   * When a `MongoClient` was injected via the constructor this returns the same instance,
   * so sessions created from it work seamlessly with all facade methods.
   *
   * @throws Error if called before {@link initialize}
   *
   * @example
   * ```typescript
   * const client = gibbonsDb.getMongoClient();
   * const session = client.startSession();
   * ```
   */
  public getMongoClient(): MongoClient {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.mongoClient) {
      throw new Error(
        'GibbonsMongoDb is not initialized. Call initialize() first.'
      );
    }
    return this.mongoClient;
  }

  /**
   * Initialize the GibbonsMongoDb instance by setting up
   * the collections for users, groups, and permissions.
   *
   * When constructed with a URI a new `MongoClient` connection is created.
   * When constructed with an existing `MongoClient` the connection is re-used.
   *
   * Must be called before using any other methods.
   */
  public async initialize(): Promise<void> {
    const { mongoClientOrUri, config } = this;

    this.mongoClient =
      typeof mongoClientOrUri === 'string'
        ? await MongoClient.connect(mongoClientOrUri)
        : mongoClientOrUri;

    const { mongoClient } = this;

    this.gibbonUser = new GibbonUser(mongoClient);
    this.gibbonPermission = new GibbonPermission(mongoClient, config);
    this.gibbonGroup = new GibbonGroup(mongoClient, config);

    const {
      dbName,
      dbStructure: { group, permission, user },
    } = config;

    await Promise.all([
      this.gibbonUser.initialize(dbName, user.collectionName),
      this.gibbonPermission.initialize(dbName, permission.collectionName),
      this.gibbonGroup.initialize(dbName, group.collectionName),
    ]);
  }

  /**
   * Creates a session-aware {@link IPermissionsResource} that threads the
   * transaction session into the underlying group query, so that reads
   * inside the transaction see uncommitted writes.
   */
  private sessionAwarePermissionsResource(
    session: ClientSession
  ): IPermissionsResource {
    return {
      getPermissionsGibbonForGroups: (groups: Gibbon) =>
        this.gibbonGroup.getPermissionsGibbonForGroups(groups, session),
    };
  }

  /**
   * Runs `fn` inside a transaction when no external session is provided,
   * or uses the provided session directly (caller owns the transaction).
   */
  private async executeInSession<T>(
    session: ClientSession | undefined,
    fn: (session: ClientSession) => Promise<T>
  ): Promise<T> {
    if (session) {
      return fn(session);
    }
    return withTransaction(this.mongoClient, fn);
  }

  /**
   * Fetches aggregated permissions from groups
   * (Useful to store at the user itself for fast access)
   *
   * @param groups - Group positions or Gibbon representing groups
   * @returns A Gibbon with all permissions merged from the specified groups
   *
   * @example
   * ```typescript
   * // Get all permissions from admin and editor groups
   * const permissionsGibbon = await gibbonsDb.getPermissionsGibbonForGroups([1, 2]);
   * const permissionPositions = permissionsGibbon.getPositionsArray();
   * console.log(permissionPositions); // e.g., [1, 2, 5, 6, 10]
   * ```
   */
  public async getPermissionsGibbonForGroups(
    groups: GibbonLike
  ): Promise<Gibbon> {
    return this.gibbonGroup.getPermissionsGibbonForGroups(groups);
  }

  /**
   * Convenience function to retrieve group documents by positions
   *
   * @param groups Contains group positions to query for
   * @returns A MongoDB FindCursor
   *
   * @example
   * ```typescript
   * const cursor = gibbonsDb.findGroups([1, 2, 3]);
   * for await (const group of cursor) {
   *   console.log(group.name, group.permissionsGibbon);
   * }
   * ```
   */
  public findGroups(groups: GibbonLike): FindCursor {
    return this.gibbonGroup.find(groups);
  }

  /**
   * Convenience function to retrieve permission documents by positions
   *
   * @param permissions Contains permission positions to query for
   * @returns A MongoDB FindCursor
   *
   * @example
   * ```typescript
   * const cursor = gibbonsDb.findPermissions([5, 6, 7]);
   * for await (const perm of cursor) {
   *   console.log(perm.name, perm.gibbonPermissionPosition);
   * }
   * ```
   */
  public findPermissions(
    permissions: GibbonLike
  ): FindCursor<IGibbonPermission> {
    return this.gibbonPermission.find(permissions);
  }

  /**
   * Find allocated groups where permissions are subscribed
   *
   * @param permissions Permissions to query for
   * @param allocated Match for allocated (default) or non-allocated
   * @returns groups Cursor
   *
   * @example
   * ```typescript
   * // Find all groups that have edit or delete permissions
   * const cursor = gibbonsDb.findGroupsByPermissions([5, 6]);
   * for await (const group of cursor) {
   *   console.log(`Group ${group.name} has edit/delete permissions`);
   * }
   * ```
   */
  public findGroupsByPermissions(
    permissions: GibbonLike,
    allocated = true
  ): FindCursor {
    return this.gibbonGroup.findByPermissions(permissions, allocated);
  }

  /**
   * Find users where permissions are subscribed
   *
   * @param permissions Permissions to query for
   * @returns users Cursor
   *
   * @example
   * ```typescript
   * // Find all users with delete permission
   * const cursor = gibbonsDb.findUsersByPermissions([6]);
   * const usersWithDelete = await cursor.toArray();
   * ```
   */
  public findUsersByPermissions(permissions: GibbonLike): FindCursor {
    return this.gibbonUser.findByPermissions(permissions);
  }

  /**
   * Find users where groups are subscribed
   *
   * @param groups Groups to query for
   * @returns users Cursor
   *
   * @example
   * ```typescript
   * // Find all users in admin or moderator groups
   * const cursor = gibbonsDb.findUsersByGroups([1, 2]);
   * for await (const user of cursor) {
   *   console.log(`${user.name} is admin or moderator`);
   * }
   * ```
   */
  public findUsersByGroups(groups: GibbonLike): FindCursor {
    return this.gibbonUser.findByGroups(groups);
  }

  /**
   * Allocates a new permission with any desirable document structure
   * It searches for the first available non-allocated permission and allocates it,
   * and stores additional given data
   *
   * @param data Anything really, at least MongoDB compatible
   * @returns Created permission
   *
   * @example
   * ```typescript
   * const permission = await gibbonsDb.allocatePermission({
   *   name: 'edit_posts',
   *   description: 'Allows editing blog posts'
   * });
   * console.log(permission.gibbonPermissionPosition); // e.g., 1
   * console.log(permission.gibbonIsAllocated); // true
   * ```
   */
  async allocatePermission<T>(
    data: T,
    session?: ClientSession
  ): Promise<IGibbonPermission> {
    return this.gibbonPermission.allocate(data, session);
  }

  /**
   * Deallocates permission(s)
   * - Deallocates permission and sets them to default values
   * - Removes related permissions from groups and users
   *
   * Runs inside a transaction for atomicity.
   *
   * @param permissions - Permission position collection
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * // Deallocate single permission
   * await gibbonsDb.deallocatePermissions([5]);
   *
   * // Deallocate multiple permissions
   * await gibbonsDb.deallocatePermissions([1, 2, 3]);
   * ```
   */
  async deallocatePermissions(
    permissions: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      await this.gibbonPermission.deallocate(permissions, s);
      await this.gibbonGroup.unsetPermissions(permissions, s);
      await this.gibbonUser.unsetPermissions(permissions, s);
    });
  }

  /**
   * Search for the first available non-allocated group, then allocates it,
   * and stores the given additional/desirable data
   *
   * @example
   *
   * Let's assume, position 1 and 2 aren't allocated, but 3 is. We should expect the 3rd time, to allocate position 4
   *
   * ```
   *
   * // First time (no allocations made before)
   * const { gibbonGroupPosition: firstPosition } = await gibbonsMongoDb.allocateGroup({
   *   name: "My allocated test group 1 (should be position 1)",
   * });
   *
   * firstPosition; // Should be the value 1
   *
   * const { gibbonGroupPosition: secondPosition } = await gibbonsMongoDb.allocateGroup({
   *   name: "My allocated test group 1 (should be position 2)",
   * });
   *
   * secondPosition; //Should be the value 2
   *
   * const { gibbonGroupPosition: thirdPosition } = await gibbonsMongoDb.allocateGroup({
   *   name: "My allocated test group 1 (should be position 4 since 3 was already taken)",
   * });
   *
   * thirdPosition; //Should be the value 4
   * ```
   *
   * @param data Anything really, at least MongoDB compatible
   * @returns Created group
   */
  public async allocateGroup<OmitGibbonGroupPosition>(
    data: OmitGibbonGroupPosition,
    session?: ClientSession
  ): Promise<IGibbonGroup> {
    return this.gibbonGroup.allocate(data, session);
  }

  /**
   * Resets default values to each given group, then
   * it removes membership from each user for these groups
   *
   * Runs inside a transaction for atomicity.
   *
   * @param groups - Group positions collection
   *
   * @example
   * ```typescript
   * // Deallocate single group
   * await gibbonsDb.deallocateGroups([3]);
   *
   * // Deallocate multiple groups
   * await gibbonsDb.deallocateGroups([1, 2, 4]);
   * ```
   */
  public async deallocateGroups(
    groups: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      const permissionsResource = this.sessionAwarePermissionsResource(s);
      await this.gibbonGroup.deallocate(groups, s);
      await this.gibbonUser.unsetGroups(groups, permissionsResource, s);
    });
  }

  /**
   * Given a set of user groups, validate if they have ALL given groups set
   *
   * @param userGroups User groups
   * @param groups Groups to compare with
   *
   * @example
   * ```typescript
   * const userGroups = [1, 2, 3, 4];
   * const requiredGroups = [2, 4];
   * const hasAll = gibbonsDb.validateUserGroupsForAllGroups(userGroups, requiredGroups);
   * console.log(hasAll); // true (user has all required groups)
   * ```
   */
  public validateUserGroupsForAllGroups(
    userGroups: GibbonLike,
    groups: GibbonLike
  ): boolean {
    const userGroupsGibbon = this.gibbonGroup.ensureGibbon(userGroups);
    const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
    return userGroupsGibbon.hasAllFromGibbon(groupsGibbon);
  }

  /**
   * Given a set of user groups, validate if they have ANY of given groups set
   *
   * @param userGroups User groups
   * @param groups Groups to compare with
   *
   * @example
   * ```typescript
   * const userGroups = [1, 2];
   * const checkGroups = [2, 4, 6];
   * const hasAny = gibbonsDb.validateUserGroupsForAnyGroups(userGroups, checkGroups);
   * console.log(hasAny); // true (user has group 2)
   * ```
   */
  public validateUserGroupsForAnyGroups(
    userGroups: GibbonLike,
    groups: GibbonLike
  ): boolean {
    const userGroupsGibbon = this.gibbonGroup.ensureGibbon(userGroups);
    const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
    return userGroupsGibbon.hasAnyFromGibbon(groupsGibbon);
  }

  /**
   * Given a set of user permissions, validate if this has ALL of given permissions set
   *
   * @param userPermissions User permissions
   * @param permissions Permissions to compare with
   * @returns true if user has all the specified permissions
   *
   * @example
   * ```typescript
   * const userPerms = [1, 2, 3, 5, 8];
   * const requiredPerms = [2, 5];
   * const hasAll = gibbonsDb.validateUserPermissionsForAllPermissions(
   *   userPerms,
   *   requiredPerms
   * );
   * console.log(hasAll); // true (user has both 2 and 5)
   * ```
   */
  public validateUserPermissionsForAllPermissions(
    userPermissions: GibbonLike,
    permissions: GibbonLike
  ): boolean {
    const userPermissionsGibbon =
      this.gibbonPermission.ensureGibbon(userPermissions);
    const permissionsGibbon = this.gibbonPermission.ensureGibbon(permissions);
    return userPermissionsGibbon.hasAllFromGibbon(permissionsGibbon);
  }

  /**
   * Given a set of permissions, validate if it has ANY of these given permissions set
   *
   * @param userPermissions User permissions
   * @param permissions To compare with
   * @returns true if user has at least one of the specified permissions
   *
   * @example
   * ```typescript
   * const userPerms = [1, 3];
   * const checkPerms = [2, 3, 4];
   * const hasAny = gibbonsDb.validateUserPermissionsForAnyPermissions(
   *   userPerms,
   *   checkPerms
   * );
   * console.log(hasAny); // true (user has permission 3)
   * ```
   */
  public validateUserPermissionsForAnyPermissions(
    userPermissions: GibbonLike,
    permissions: GibbonLike
  ): boolean {
    const userPermissionsGibbon =
      this.gibbonPermission.ensureGibbon(userPermissions);
    const permissionsGibbon = this.gibbonPermission.ensureGibbon(permissions);
    return userPermissionsGibbon.hasAnyFromGibbon(permissionsGibbon);
  }

  /**
   * Queries database if given groups are indeed allocated (possible to validate the non-allocated ones)
   *
   * @param groups - Group positions to validate
   * @param allocated - Search for allocated or non-allocated (defaults to true)
   * @returns true if all groups match the allocation state
   *
   * @example
   * ```typescript
   * // Check if groups 1 and 2 are allocated
   * const isAllocated = await gibbonsDb.validateAllocatedGroups([1, 2]);
   * if (isAllocated) {
   *   console.log('Groups are ready to use');
   * }
   * ```
   */
  public async validateAllocatedGroups(
    groups: GibbonLike,
    allocated = true
  ): Promise<boolean> {
    return this.gibbonGroup.validate(groups, allocated);
  }

  /**
   * Queries database if given permissions are indeed allocated (possible to validate the non-allocated ones)
   *
   * @param permissions - Permission positions to validate
   * @param allocated - Search for allocated or non-allocated (defaults to true)
   * @returns true if all permissions match the allocation state
   *
   * @example
   * ```typescript
   * const valid = await gibbonsDb.validateAllocatedPermissions([5, 6, 7]);
   * if (!valid) {
   *   throw new Error('Some permissions are not allocated');
   * }
   * ```
   */
  public async validateAllocatedPermissions(
    permissions: GibbonLike,
    allocated = true
  ): Promise<boolean> {
    return this.gibbonPermission.validate(permissions, allocated);
  }

  /**
   * Retrieve users and their current group membership, patch given groups and update their aggregated permissions
   *
   * Runs inside a transaction for atomicity.
   *
   * @param filter - MongoDB filter to select users
   * @param groups - Group positions to subscribe users to
   *
   * @example
   * ```typescript
   * // Subscribe all users with specific email to admin group
   * await gibbonsDb.subscribeUsersToGroups(
   *   { email: 'admin@example.com' },
   *   [1] // Admin group at position 1
   * );
   *
   * // Subscribe multiple users by ID to multiple groups
   * await gibbonsDb.subscribeUsersToGroups(
   *   { _id: { $in: [userId1, userId2] } },
   *   [2, 3, 4] // Editor, Moderator, Viewer groups
   * );
   * ```
   */
  async subscribeUsersToGroups(
    filter: Filter<IGibbonUser>,
    groups: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
      const valid = await this.gibbonGroup.validate(groupsGibbon, true, s);

      if (!valid) {
        throw new Error(
          `Suggested groups aren't valid (not allocated): ${groupsGibbon.getPositionsArray()}`
        );
      }

      // First we need to know which permissions belong to these given groups
      const permissionsGibbon =
        await this.gibbonGroup.getPermissionsGibbonForGroups(groupsGibbon, s);
      // Delegate the search for users and subscribe them
      await this.gibbonUser.subscribeToGroupsAndPermissions(
        filter,
        groupsGibbon,
        permissionsGibbon,
        s
      );
    });
  }

  /**
   * Subscribe (set) permissions to given groups
   * Users subscribed to these groups need to be updated with these additional permissions
   *
   * Runs inside a transaction for atomicity.
   *
   * @param groups - Group positions to add permissions to
   * @param permissions - Permission positions to subscribe
   * @throws Error when given groups or permissions are not allocated
   *
   * @example
   * ```typescript
   * // Add edit and delete permissions to admin group
   * await gibbonsDb.subscribePermissionsToGroups(
   *   [1], // Admin group
   *   [5, 6] // Edit and delete permissions
   * );
   *
   * // All users in admin group will automatically receive these permissions
   * ```
   */
  async subscribePermissionsToGroups(
    groups: GibbonLike,
    permissions: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
      const permissionGibbon = this.gibbonPermission.ensureGibbon(permissions);

      // Validate to ensure groups and permissions are allocated
      const [permissionsValid, groupsValid] = await Promise.all([
        this.gibbonPermission.validate(permissionGibbon, true, s),
        this.gibbonGroup.validate(groupsGibbon, true, s),
      ]);

      if (!permissionsValid) {
        throw new Error(
          `Suggested permissions are not valid (not allocated): ${permissionGibbon.getPositionsArray()}`
        );
      }
      if (!groupsValid) {
        throw new Error(
          `Suggested groups are not valid (not allocated): ${groupsGibbon.getPositionsArray()}`
        );
      }

      // First update groups with these permissions
      await this.gibbonGroup.subscribePermissions(
        groupsGibbon,
        permissionGibbon,
        s
      );

      // Ensure users subscribed to these groups are updated with these permissions
      await this.gibbonUser.subscribeToPermissionsForGroups(
        groupsGibbon,
        permissionGibbon,
        s
      );
    });
  }

  /**
   * Create a new user with initial empty gibbons
   * Additional custom data can be passed (e.g. name, email)
   *
   * @param data - User data to store (e.g., name, email, username)
   * @returns The created user document with empty group and permission gibbons
   *
   * @example
   * ```typescript
   * const user = await gibbonsDb.createUser({
   *   name: 'John Doe',
   *   email: 'john@example.com',
   *   username: 'johndoe'
   * });
   *
   * console.log(user._id); // MongoDB ObjectId
   * console.log(user.groupsGibbon); // Empty Gibbon (no groups yet)
   * console.log(user.permissionsGibbon); // Empty Gibbon (no permissions yet)
   * ```
   */
  async createUser<T>(data: T, session?: ClientSession): Promise<IGibbonUser> {
    const { groupByteLength, permissionByteLength } = this.config;
    return this.gibbonUser.create(
      data,
      groupByteLength,
      permissionByteLength,
      session
    );
  }

  /**
   * Remove user(s) matching the given filter
   *
   * @param filter - MongoDB filter to select users to remove
   * @returns Number of removed users
   *
   * @example
   * ```typescript
   * // Remove users by email
   * const count = await gibbonsDb.removeUser({ email: 'user@example.com' });
   * console.log(`Removed ${count} user(s)`);
   *
   * // Remove multiple users by IDs
   * await gibbonsDb.removeUser({ _id: { $in: [id1, id2, id3] } });
   * ```
   */
  async removeUser(
    filter: Filter<IGibbonUser>,
    session?: ClientSession
  ): Promise<number> {
    return this.gibbonUser.remove(filter, session);
  }

  /**
   * Find users by arbitrary MongoDB filter
   *
   * @param filter - MongoDB filter query
   * @returns A MongoDB FindCursor for iteration
   *
   * @example
   * ```typescript
   * // Find users by email
   * const cursor = gibbonsDb.findUsers({ email: 'user@example.com' });
   * for await (const user of cursor) {
   *   console.log(user.name);
   * }
   *
   * // Find users created after a date
   * const recentUsers = gibbonsDb.findUsers({
   *   createdAt: { $gte: new Date('2024-01-01') }
   * });
   * ```
   */
  public findUsers(filter: Filter<IGibbonUser>): FindCursor<IGibbonUser> {
    return this.gibbonUser.findByFilter(filter);
  }

  /**
   * List all allocated groups
   *
   * @returns A MongoDB FindCursor of all allocated group documents
   *
   * @example
   * ```typescript
   * const cursor = gibbonsDb.findAllAllocatedGroups();
   * const groups = await cursor.toArray();
   * groups.forEach(group => {
   *   console.log(`${group.name} (position: ${group.gibbonGroupPosition})`);
   * });
   * ```
   */
  public findAllAllocatedGroups(): FindCursor<IGibbonGroup> {
    return this.gibbonGroup.findAllocated();
  }

  /**
   * List all allocated permissions
   *
   * @returns A MongoDB FindCursor of all allocated permission documents
   *
   * @example
   * ```typescript
   * const cursor = gibbonsDb.findAllAllocatedPermissions();
   * const permissions = await cursor.toArray();
   * console.log(`Total allocated: ${permissions.length}`);
   * ```
   */
  public findAllAllocatedPermissions(): FindCursor<IGibbonPermission> {
    return this.gibbonPermission.findAllocated();
  }

  /**
   * Update metadata on an allocated group (e.g. name, description)
   * Does not modify gibbonGroupPosition, gibbonIsAllocated or permissionsGibbon
   *
   * @param groupPosition - The position of the group to update
   * @param data - Metadata fields to update
   * @returns The updated group document, or null if not found
   *
   * @example
   * ```typescript
   * const updated = await gibbonsDb.updateGroupMetadata(1, {
   *   name: 'Super Admins',
   *   description: 'Users with full system access',
   *   color: '#FF0000'
   * });
   * ```
   */
  public async updateGroupMetadata<T extends Record<string, unknown>>(
    groupPosition: number,
    data: T,
    session?: ClientSession
  ): Promise<IGibbonGroup | null> {
    return this.gibbonGroup.updateMetadata(groupPosition, data, session);
  }

  /**
   * Update metadata on an allocated permission (e.g. name, description)
   * Does not modify gibbonPermissionPosition or gibbonIsAllocated
   *
   * @param permissionPosition - The position of the permission to update
   * @param data - Metadata fields to update
   * @returns The updated permission document, or null if not found
   *
   * @example
   * ```typescript
   * const updated = await gibbonsDb.updatePermissionMetadata(5, {
   *   name: 'posts.edit',
   *   description: 'Edit any blog post',
   *   module: 'blog'
   * });
   * ```
   */
  public async updatePermissionMetadata<T extends Record<string, unknown>>(
    permissionPosition: number,
    data: T,
    session?: ClientSession
  ): Promise<IGibbonPermission | null> {
    return this.gibbonPermission.updateMetadata(
      permissionPosition,
      data,
      session
    );
  }

  /**
   * Update metadata on a user (e.g. name, email)
   * Does not modify groupsGibbon or permissionsGibbon
   *
   * @param filter - MongoDB filter to select the user
   * @param data - Metadata fields to update
   * @returns The updated user document, or null if not found
   *
   * @example
   * ```typescript
   * const updated = await gibbonsDb.updateUserMetadata(
   *   { email: 'old@example.com' },
   *   { email: 'new@example.com', name: 'Jane Doe' }
   * );
   * ```
   */
  public async updateUserMetadata<T extends Record<string, unknown>>(
    filter: Filter<IGibbonUser>,
    data: T,
    session?: ClientSession
  ): Promise<IGibbonUser | null> {
    return this.gibbonUser.updateMetadata(filter, data, session);
  }

  /**
   * Unsubscribe users matching filter from specific groups
   * Recalculates their permissions from remaining groups
   *
   * Runs inside a transaction for atomicity.
   *
   * @param filter - MongoDB filter to select users
   * @param groups - Group positions to remove from users
   *
   * @example
   * ```typescript
   * // Remove admin group from specific user
   * await gibbonsDb.unsubscribeUsersFromGroups(
   *   { email: 'user@example.com' },
   *   [1] // Admin group
   * );
   * // User's permissions are recalculated from remaining groups
   * ```
   */
  async unsubscribeUsersFromGroups(
    filter: Filter<IGibbonUser>,
    groups: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
      const permissionsResource = this.sessionAwarePermissionsResource(s);
      await this.gibbonUser.unsubscribeFromGroups(
        filter,
        groupsGibbon,
        permissionsResource,
        s
      );
    });
  }

  /**
   * Remove specific permissions from specific groups
   * Recalculates permissions for all users in affected groups
   *
   * Runs inside a transaction for atomicity.
   *
   * @param groups - Group positions to modify
   * @param permissions - Permission positions to remove from groups
   *
   * @example
   * ```typescript
   * // Remove delete permission from editor group
   * await gibbonsDb.unsubscribePermissionsFromGroups(
   *   [2], // Editor group
   *   [6]  // Delete permission
   * );
   * // All users in editor group lose delete permission
   * ```
   */
  async unsubscribePermissionsFromGroups(
    groups: GibbonLike,
    permissions: GibbonLike,
    session?: ClientSession
  ): Promise<void> {
    await this.executeInSession(session, async (s) => {
      const groupsGibbon = this.gibbonGroup.ensureGibbon(groups);
      const permissionsGibbon = this.gibbonPermission.ensureGibbon(permissions);
      const permissionsResource = this.sessionAwarePermissionsResource(s);

      // 1. Remove permissions from the specified groups
      await this.gibbonGroup.unsubscribePermissions(
        groupsGibbon,
        permissionsGibbon,
        s
      );

      // 2. Recalculate permissions for all users in those groups
      const groupsBinary = new Binary(groupsGibbon.toBuffer());
      await this.gibbonUser.recalculatePermissions(
        { groupsGibbon: { $bitsAnySet: groupsBinary } } as Filter<IGibbonUser>,
        permissionsResource,
        s
      );
    });
  }

  /**
   * Expands the permission byte length, seeding new permission slots and
   * resizing all Binary `permissionsGibbon` fields in groups and users.
   *
   * @param newByteLength - Must be greater than the current `permissionByteLength`
   * @param session - Optional external session (caller owns the transaction)
   *
   * @example
   * ```typescript
   * // Double the permission capacity
   * await gibbonsDb.expandPermissions(config.permissionByteLength * 2);
   * ```
   */
  async expandPermissions(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const oldByteLength = this.config.permissionByteLength;
    if (newByteLength <= oldByteLength) {
      throw new Error(
        `newByteLength (${newByteLength}) must be greater than current permissionByteLength (${oldByteLength})`
      );
    }

    await this.executeInSession(session, async (s) => {
      // 1. Seed new permission slots
      const seeder = new MongoDbSeeder(this.mongoClient, this.config);
      await seeder.seedRange(
        'permission',
        oldByteLength * 8 + 1,
        newByteLength * 8
      );

      // 2. Resize permissionsGibbon in every group doc
      await this.gibbonGroup.resizePermissions(newByteLength, s);

      // 3. Resize permissionsGibbon in every user doc
      await this.gibbonUser.resizePermissions(newByteLength, s);

      // 4. Update config and model byte lengths
      this.config.permissionByteLength = newByteLength;
      (this.gibbonPermission as unknown as { byteLength: number }).byteLength =
        newByteLength;
    });
  }

  /**
   * Expands the group byte length, seeding new group slots and
   * resizing all Binary `groupsGibbon` fields in users.
   *
   * @param newByteLength - Must be greater than the current `groupByteLength`
   * @param session - Optional external session (caller owns the transaction)
   *
   * @example
   * ```typescript
   * await gibbonsDb.expandGroups(config.groupByteLength * 2);
   * ```
   */
  async expandGroups(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const oldByteLength = this.config.groupByteLength;
    if (newByteLength <= oldByteLength) {
      throw new Error(
        `newByteLength (${newByteLength}) must be greater than current groupByteLength (${oldByteLength})`
      );
    }

    await this.executeInSession(session, async (s) => {
      // 1. Seed new group slots (with empty permissionsGibbon at current perm byte length)
      const seeder = new MongoDbSeeder(this.mongoClient, this.config);
      await seeder.seedRange('group', oldByteLength * 8 + 1, newByteLength * 8);

      // 2. Resize groupsGibbon in every user doc
      await this.gibbonUser.resizeGroups(newByteLength, s);

      // 3. Update config and model byte lengths
      this.config.groupByteLength = newByteLength;
      (this.gibbonGroup as unknown as { byteLength: number }).byteLength =
        newByteLength;
    });
  }

  /**
   * Shrinks the permission byte length, removing trailing permission slots
   * and truncating all Binary `permissionsGibbon` fields in groups and users.
   *
   * @param newByteLength - Must be less than the current `permissionByteLength`
   * @param session - Optional external session (caller owns the transaction)
   * @throws Error if allocated permissions exist beyond the new boundary
   *
   * @example
   * ```typescript
   * await gibbonsDb.shrinkPermissions(64);
   * ```
   */
  async shrinkPermissions(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const oldByteLength = this.config.permissionByteLength;
    if (newByteLength >= oldByteLength) {
      throw new Error(
        `newByteLength (${newByteLength}) must be less than current permissionByteLength (${oldByteLength})`
      );
    }

    await this.executeInSession(session, async (s) => {
      // 1. Safety check — count allocated permissions beyond the new boundary
      const db = this.mongoClient.db(this.config.dbName);
      const permCollection = db.collection(
        this.config.dbStructure.permission.collectionName
      );
      const beyondCount = await permCollection.countDocuments(
        {
          gibbonPermissionPosition: { $gt: newByteLength * 8 },
          gibbonIsAllocated: true,
        },
        { session: s }
      );
      if (beyondCount > 0) {
        throw new Error(
          'Cannot shrink: allocated permissions exist beyond the new boundary'
        );
      }

      // 2. Delete trailing permission slots
      await permCollection.deleteMany(
        { gibbonPermissionPosition: { $gt: newByteLength * 8 } },
        { session: s }
      );

      // 3. Truncate permissionsGibbon in every group doc
      await this.gibbonGroup.resizePermissions(newByteLength, s);

      // 4. Truncate permissionsGibbon in every user doc
      await this.gibbonUser.resizePermissions(newByteLength, s);

      // 5. Update config and model byte lengths
      this.config.permissionByteLength = newByteLength;
      (this.gibbonPermission as unknown as { byteLength: number }).byteLength =
        newByteLength;
    });
  }

  /**
   * Shrinks the group byte length, removing trailing group slots
   * and truncating all Binary `groupsGibbon` fields in users.
   *
   * @param newByteLength - Must be less than the current `groupByteLength`
   * @param session - Optional external session (caller owns the transaction)
   * @throws Error if allocated groups exist beyond the new boundary
   *
   * @example
   * ```typescript
   * await gibbonsDb.shrinkGroups(64);
   * ```
   */
  async shrinkGroups(
    newByteLength: number,
    session?: ClientSession
  ): Promise<void> {
    const oldByteLength = this.config.groupByteLength;
    if (newByteLength >= oldByteLength) {
      throw new Error(
        `newByteLength (${newByteLength}) must be less than current groupByteLength (${oldByteLength})`
      );
    }

    await this.executeInSession(session, async (s) => {
      // 1. Safety check — count allocated groups beyond the new boundary
      const db = this.mongoClient.db(this.config.dbName);
      const groupCollection = db.collection(
        this.config.dbStructure.group.collectionName
      );
      const beyondCount = await groupCollection.countDocuments(
        {
          gibbonGroupPosition: { $gt: newByteLength * 8 },
          gibbonIsAllocated: true,
        },
        { session: s }
      );
      if (beyondCount > 0) {
        throw new Error(
          'Cannot shrink: allocated groups exist beyond the new boundary'
        );
      }

      // 2. Delete trailing group slots
      await groupCollection.deleteMany(
        { gibbonGroupPosition: { $gt: newByteLength * 8 } },
        { session: s }
      );

      // 3. Truncate groupsGibbon in every user doc
      await this.gibbonUser.resizeGroups(newByteLength, s);

      // 4. Update config and model byte lengths
      this.config.groupByteLength = newByteLength;
      (this.gibbonGroup as unknown as { byteLength: number }).byteLength =
        newByteLength;
    });
  }
}
