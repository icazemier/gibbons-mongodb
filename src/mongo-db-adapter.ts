import { Gibbon } from "@icazemier/gibbons";
import {
    Document,
    Filter,
    FindCursor,
    FindOneAndUpdateOptions,
    FindOptions,
    MongoClient,
} from "mongodb";
import PQueue from "p-queue";
import { Config, DbCollection } from "types.js";

/**
 * Class which does all the heavy lifting against MongDB
 */
export class MongoDBAdapter {
    private dbCollection: DbCollection;
    private config: Config;

    /**
     * Accepts a MongoDB group Document and tries to transform it to a GibbonGroup
     * @param {Document} group
     * @returns {GibbonGroup}
     */
    protected static transformGroup(config: Config, group: Document) {
        const transformedGroup = { ...group };
        const { buffer: permissionBuffer } =
            transformedGroup[config.dbStructure.group.fields.permissionsGibbon];
        transformedGroup[config.dbStructure.group.fields.permissionsGibbon] =
            Gibbon.decode(permissionBuffer);
        return { ...transformedGroup };
    }

    /**
     * Accepts a MongoDB user Document and tries to transform the Binary->Buffers inside to Gibbons
     * @param {Config} config
     * @param {Document} user
     */
    protected static transformUser(config: Config, user: Document) {
        const transformedUser = { ...user };

        const { buffer: permissionBuffer } =
            transformedUser[config.dbStructure.user.fields.permissionsGibbon];
        const { buffer: groupBuffer } =
            transformedUser[config.dbStructure.user.fields.groupsGibbon];

        transformedUser[config.dbStructure.user.fields.permissionsGibbon] =
            Gibbon.decode(permissionBuffer);
        transformedUser[config.dbStructure.user.fields.groupsGibbon] =
            Gibbon.decode(groupBuffer);

        return { ...transformedUser };
    }

    constructor(mongoClient: MongoClient, config: Config) {
        // map collections for convenience
        const user = mongoClient
            .db(config.dbStructure.user.dbName)
            .collection(config.dbStructure.user.collection);
        const group = mongoClient
            .db(config.dbStructure.group.dbName)
            .collection(config.dbStructure.group.collection);
        const permission = mongoClient
            .db(config.dbStructure.permission.dbName)
            .collection(config.dbStructure.permission.collection);

        this.config = config;
        this.dbCollection = { user, group, permission } as DbCollection;
    }

    /**
     * Convenience function which accepts an Array of positions or a Gibbon
     * In case of an Array it creates a Gibbon
     * @param {Gibbon | Array<number>} positions
     * @param {number} byteLength
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

    ensureGroupGibbon(positions: Gibbon | Array<number> | Buffer): Gibbon {
        return MongoDBAdapter.ensureGibbon(
            positions,
            this.config.groupByteLength
        );
    }

    ensurePermissionGibbon(positions: Gibbon | Array<number> | Buffer): Gibbon {
        return MongoDBAdapter.ensureGibbon(
            positions,
            this.config.permissionByteLength
        );
    }

    /**
     * Fetches aggregated permissions from groups
     * Useful to store at the user itself for fast access
     *
     * @param {Gibbon | Array<number> | Buffer} groups
     * @returns {Promise<Gibbon>}
     */
    async getPermissionsGibbonForGroups(
        groups: Gibbon | Array<number> | Buffer
    ): Promise<Gibbon> {
        const groupPositions =
            this.ensureGroupGibbon(groups).getPositionsArray();

        // Create fresh permissions space as we're rebuilding from scratch
        const permissionGibbon = Gibbon.create(
            this.config.permissionByteLength
        );

        // Get FindCursor instance for groups groups
        const groupCursor = await this.dbCollection.group.find(
            {
                [this.config.dbStructure.group.fields.gibbonGroupPosition]: {
                    $in: groupPositions,
                },
            },
            {
                projection: {
                    _id: 0,
                    [this.config.dbStructure.group.fields.permissionsGibbon]: 1,
                },
            }
        );

        // Iterate through all these specific groups and collect permissions
        for await (const group of groupCursor) {
            const { buffer } =
                group[this.config.dbStructure.group.fields.permissionsGibbon];

            permissionGibbon.mergeWithGibbon(Gibbon.decode(buffer));
        }
        return permissionGibbon;
    }

    /**
     * Returns a MongoDB FindCursor to fetch a collection of groups
     *
     * @param {Gibbon|Array<number>} groups - containing gibbon or positions to query for
     * @returns {FindCursor} Fetched groups from one given user
     */
    findGroups(groups: Gibbon | Array<number> | Buffer): FindCursor {
        const positions = this.ensureGroupGibbon(groups).getPositionsArray();
        return this.dbCollection.group
            .find({
                [this.config.dbStructure.group.fields.gibbonGroupPosition]: {
                    $in: positions,
                },
            })
            .map((group) => MongoDBAdapter.transformGroup(this.config, group));
    }

    /**
     * Tries to fetch groups by permissions
     *
     * @param {Gibbon | Array<number> | Buffer} permissions
     * @param {boolean} [allocated = true] By default we query for allocated groups
     * @returns {FindCursor<Document>} groups - Collection of found groups
     */
    findGroupsByPermissions(
        permissions: Gibbon | Array<number> | Buffer,
        allocated = true
    ): FindCursor<Document> {
        const permissionBuffer =
            this.ensurePermissionGibbon(permissions).encode();
        const query = allocated
            ? {
                  [this.config.dbStructure.group.fields.gibbonIsAllocated]:
                      true,
              }
            : {
                  [this.config.dbStructure.group.fields.gibbonIsAllocated]: {
                      $ne: true,
                  },
              };

        return this.dbCollection.group
            .find({
                ...query,
                ...{
                    [this.config.dbStructure.group.fields.permissionsGibbon]: {
                        $bitsAnySet: permissionBuffer,
                    },
                },
            })
            .map((group) => MongoDBAdapter.transformGroup(this.config, group));
    }

    /**
     * Tries to fetch users by permissions
     *
     * @param {Gibbon | Array<number> | Buffer} permissions
     * @returns {FindCursor<Document>} Collection of found users
     */
    findUsersByPermissions(
        permissions: Gibbon | Array<number> | Buffer
    ): FindCursor<Document> {
        const permissionBuffer =
            this.ensurePermissionGibbon(permissions).encode();

        const query = {
            [this.config.dbStructure.user.fields.permissionsGibbon]: {
                $bitsAnySet: permissionBuffer,
            },
        };

        return this.dbCollection.user
            .find(query)
            .map((user) => MongoDBAdapter.transformUser(this.config, user));
    }

    /**
     * Tries to fetch users by groups
     *
     * @param {Gibbon | Array<number> | Buffer} gibbon - representing groups
     * @returns {FindCursor<Document>} Collection of found users
     */
    findUsersByGroups(
        groups: Gibbon | Array<number> | Buffer
    ): FindCursor<Document> {
        const buffer = this.ensureGroupGibbon(groups).encode();

        const query = {
            [this.config.dbStructure.user.fields.groupsGibbon]: {
                $bitsAnySet: buffer,
            },
        };
        return this.dbCollection.user
            .find(query)
            .map((user) => MongoDBAdapter.transformUser(this.config, user));
    }

    /**
     * Allocates a new permission with any desireable document structure
     * It searches for the first available non allocated permission and allocates it,
     * and stores additional given data
     * Note: It ensurea the additional `allocated` field is set to `true` (See config)
     *
     * @param {T} data - Anything really, at least MongoDB compatible
     * @returns {Document} Created permission
     */
    async allocatePermission<T>(data: T): Promise<Document> {
        // Query fo a non allocated permission
        const query = {
            [this.config.dbStructure.permission.fields.gibbonIsAllocated]:
                false,
        };
        // Sort, get one from the beginning
        const options = {
            returnDocument: "after",
            sort: [
                this.config.dbStructure.permission.fields
                    .gibbonPermissionPosition,
                1,
            ],
        } as FindOneAndUpdateOptions;
        // Prepare an update, ensure we allocate
        const update = {
            $set: {
                ...data,
                [this.config.dbStructure.permission.fields.gibbonIsAllocated]:
                    true,
            },
        };
        const { value: permission } =
            await this.dbCollection.permission.findOneAndUpdate(
                query,
                update,
                options
            );
        if (!permission) {
            throw new Error(
                "Not able to allocate permission, seems all permissions are allocated"
            );
        }
        return permission;
    }

    /**
     * Deallocates permission(s)
     * - Deallocates permission and sets them to default values
     * - Removes related permissions from groups and users
     *
     * @param {Gibbon | Array<number> | Buffer} permissions - Permission position collection
     * @returns {Promise<void>}
     */
    async deallocatePermissions(
        permissions: Gibbon | Array<number> | Buffer
    ): Promise<void> {
        const permissionGibbon = this.ensurePermissionGibbon(permissions);
        const permissionsBuffer = permissionGibbon.encode();
        const permissionPositions = permissionGibbon.getPositionsArray();

        // First get the permissions themselves in a cursor
        const permissionCursor = this.dbCollection.permission.find({
            [this.config.dbStructure.permission.fields
                .gibbonPermissionPosition]: {
                $in: permissionPositions,
            },
        });

        const permissionReplaceOneQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        for await (const permission of permissionCursor) {
            // Fetch position as reference to update later
            const gibbonPermissionPosition =
                permission[
                    this.config.dbStructure.permission.fields
                        .gibbonPermissionPosition
                ];

            // Prepare to reset values to defaults (removing additional fields)
            const queueTask = this.dbCollection.permission.replaceOne(
                {
                    [this.config.dbStructure.permission.fields
                        .gibbonPermissionPosition]: gibbonPermissionPosition,
                },
                {
                    [this.config.dbStructure.permission.fields
                        .gibbonPermissionPosition]: gibbonPermissionPosition,
                    [this.config.dbStructure.permission.fields
                        .gibbonIsAllocated]: false,
                }
            );

            // Add to queue
            permissionReplaceOneQueue.add(async () => queueTask);

            // Throttle traffic towards MongoDB if needed
            if (
                permissionReplaceOneQueue.size >
                permissionReplaceOneQueue.concurrency
            ) {
                await permissionReplaceOneQueue.onSizeLessThan(
                    Math.ceil(permissionReplaceOneQueue.concurrency / 2)
                );
            }
        }

        await Promise.all([
            // Wait until queue is done executing
            permissionReplaceOneQueue.onIdle(),
            // Close cursors gracefully
            permissionCursor.close(),
        ]);

        const groupUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        // Loop through all groups check if there are any positions, then
        // be sure to unset these permissions
        const groupCursor = this.dbCollection.group.find({
            [this.config.dbStructure.group.fields.permissionsGibbon]: {
                $bitsAnySet: permissionsBuffer,
            },
        });
        for await (const group of groupCursor) {
            const groupPosition =
                group[this.config.dbStructure.group.fields.gibbonGroupPosition];
            const { buffer: permissionBuffer } =
                group[this.config.dbStructure.group.fields.permissionsGibbon];

            const gibbon =
                Gibbon.decode(permissionBuffer).unsetAllFromPositions(
                    permissionPositions
                );

            // Update permissions in this group
            const updatePromise = this.dbCollection.group.updateOne(
                {
                    [this.config.dbStructure.group.fields.gibbonGroupPosition]:
                        groupPosition,
                },
                {
                    $set: {
                        [this.config.dbStructure.group.fields
                            .permissionsGibbon]: gibbon.encode(),
                    },
                }
            );
            groupUpdateQueue.add(async () => updatePromise);
            // Throttle queue
            if (groupUpdateQueue.size > groupUpdateQueue.concurrency) {
                await groupUpdateQueue.onSizeLessThan(
                    Math.ceil(groupUpdateQueue.concurrency / 2)
                );
            }
        }
        await Promise.all([
            // Wait until queue is done executing
            groupUpdateQueue.onIdle(),
            // Close cursors gracefully
            groupCursor.close(),
        ]);

        const userUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });
        // Loop through all users check if there are any positions, then
        // be sure to unset these permissions
        const userCursor = this.dbCollection.user.find({
            [this.config.dbStructure.user.fields.permissionsGibbon]: {
                $bitsAnySet: permissionsBuffer,
            },
        });

        for await (const user of userCursor) {
            const { buffer: permissionBuffer } =
                user[this.config.dbStructure.user.fields.permissionsGibbon];

            const gibbon =
                Gibbon.decode(permissionBuffer).unsetAllFromPositions(
                    permissionPositions
                );

            // Update permissions in this group
            const updatePromise = this.dbCollection.user.updateOne(user, {
                $set: {
                    [this.config.dbStructure.user.fields.permissionsGibbon]:
                        gibbon.encode(),
                },
            });
            userUpdateQueue.add(async () => updatePromise);
            // Throttle queue
            if (userUpdateQueue.size > userUpdateQueue.concurrency) {
                await userUpdateQueue.onSizeLessThan(
                    Math.ceil(userUpdateQueue.concurrency / 2)
                );
            }
        }

        await Promise.all([
            // Wait until queue is done executing
            userUpdateQueue.onIdle(),
            // Close cursors gracefully
            userCursor.close(),
        ]);
    }

    /**
     * Search for the first available non allocated group, then allocates it,
     * and stores the given additional/desireable data
     *
     * @param {T} data - Anything really, at least MongoDB compatible
     * @returns {Document} Created group
     */
    async allocateGroup<T>(data: T): Promise<Document> {
        // Query for a non allocated group
        const query = {
            [this.config.dbStructure.group.fields.gibbonIsAllocated]: false,
        };

        // Sort, get one from the beginning
        const options = {
            returnDocument: "after",
            sort: [this.config.dbStructure.group.fields.gibbonGroupPosition, 1],
        } as FindOneAndUpdateOptions;

        // Prepare an update, ensure we allocate
        const update = {
            $set: {
                ...data,
                [this.config.dbStructure.group.fields.gibbonIsAllocated]: true,
            },
        };

        const { value: group } = await this.dbCollection.group.findOneAndUpdate(
            query,
            update,
            options
        );
        if (!group) {
            throw new Error(
                "Not able to allocate group, seems all groups are allocated"
            );
        }

        return group;
    }

    /**
     * Resets default values to each given group, then
     * it removes membership from each user for these groups
     *
     * @param { Gibbon | Array<number> | Buffer} groups - Group positions collection
     * @returns {void}
     */
    async deallocateGroups(
        groups: Gibbon | Array<number> | Buffer
    ): Promise<void> {
        const groupsToDeallocateGibbon = this.ensureGroupGibbon(groups);
        const groupsToDeallocateBuffer = groupsToDeallocateGibbon.encode();
        const positionsToDeallocate =
            groupsToDeallocateGibbon.getPositionsArray();
        const groupCursor = this.dbCollection.group.find({
            [this.config.dbStructure.group.fields.gibbonGroupPosition]: {
                $in: positionsToDeallocate,
            },
        });

        const groupReplaceOneQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        for await (const group of groupCursor) {
            // Fetch position for update
            const gibbonGroupPosition =
                group[this.config.dbStructure.group.fields.gibbonGroupPosition];

            // Prepare to reset values to defaults
            const queueTask = this.dbCollection.group.replaceOne(
                {
                    [this.config.dbStructure.group.fields.gibbonGroupPosition]:
                        gibbonGroupPosition,
                },
                {
                    // Reset to default values
                    [this.config.dbStructure.group.fields.gibbonGroupPosition]:
                        gibbonGroupPosition,
                    // New Gibbon, no permissions set
                    [this.config.dbStructure.group.fields.permissionsGibbon]:
                        Gibbon.create(this.config.groupByteLength),
                    // Set to be available for allocations again
                    [this.config.dbStructure.group.fields.gibbonIsAllocated]:
                        false,
                }
            );

            // Add to queue
            groupReplaceOneQueue.add(async () => queueTask);

            // Throttle traffic towards MongoDB if needed
            if (groupReplaceOneQueue.size > groupReplaceOneQueue.concurrency) {
                await groupReplaceOneQueue.onSizeLessThan(
                    Math.ceil(groupReplaceOneQueue.concurrency / 2)
                );
            }
        }

        await Promise.all([
            // Wait until queue is done executing
            groupReplaceOneQueue.onIdle(),
            // Close cursors gracefully
            groupCursor.close(),
        ]);

        const userUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        // Loop through all users check if there are any positions alike then
        // be sure to unset these groups when found
        // while we're at it, ensure permissions are stored also
        const userCursor = this.dbCollection.user.find({
            [this.config.dbStructure.user.fields.groupsGibbon]: {
                $bitsAnySet: groupsToDeallocateBuffer,
            },
        });

        for await (const user of userCursor) {
            // Current group subscriptions
            const { buffer: groupBuffer } =
                user[this.config.dbStructure.user.fields.groupsGibbon];

            // First remove the deallocated group(s)
            const groupsGibbon = Gibbon.decode(
                groupBuffer
            ).unsetAllFromPositions(positionsToDeallocate);

            // After this, we need to fetch all permissions again :-S
            const permissionGibbon = await this.getPermissionsGibbonForGroups(
                groupsGibbon
            );

            // Update groups and corresponding permissions for this user
            const updatePromise = this.dbCollection.user.updateOne(user, {
                $set: {
                    [this.config.dbStructure.user.fields.groupsGibbon]:
                        groupsGibbon.encode(),
                    [this.config.dbStructure.user.fields.permissionsGibbon]:
                        permissionGibbon.encode(),
                },
            });
            userUpdateQueue.add(async () => updatePromise);
            // Throttle queue
            if (userUpdateQueue.size > userUpdateQueue.concurrency) {
                await userUpdateQueue.onSizeLessThan(
                    Math.ceil(userUpdateQueue.concurrency / 2)
                );
            }
        }

        await Promise.all([
            // Wait until queue is done executing
            userUpdateQueue.onIdle(),
            // Close cursors gracefully
            userCursor.close(),
        ]);
    }

    /**
     * Given a set of user groups, validate if they have ALL given groups set
     * @param {Gibbon | Array<number> | Buffer} userGroups - User groups
     * @param {Gibbon | Array<number> | Buffer} groups - Groups to compare with
     * @returns {boolean}
     */
    validateUserGroupsForAllGroups(
        userGroups: Gibbon | Array<number> | Buffer,
        groups: Gibbon | Array<number> | Buffer
    ): boolean {
        const groupsGibbon = this.ensureGroupGibbon(groups);
        const userGroupsGibbon = this.ensureGroupGibbon(userGroups);
        return userGroupsGibbon.hasAllFromGibbon(groupsGibbon);
    }

    /**
     * Given a set of user groups, validate if they have ANY of given groups set
     * @param {Gibbon | Array<number> | Buffer} userGroups - User groups
     * @param {Gibbon | Array<number>|Buffer} groups - Groups to compare with
     */
    validateUserGroupsForAnyGroups(
        userGroups: Gibbon | Array<number> | Buffer,
        groups: Gibbon | Array<number> | Buffer
    ) {
        const userGroupsGibbon = this.ensureGroupGibbon(userGroups);
        const groupsGibbon = this.ensureGroupGibbon(groups);
        return userGroupsGibbon.hasAnyFromGibbon(groupsGibbon);
    }

    /**
     * Given a set of user permissions, validate if this has ALL of given permissions set
     * @param {Gibbon | Array<number> | Buffer} userPermissions - User permissions
     * @param {Gibbon | Array<number> | Buffer} permissions - Permissions to compare with
     * @returns {boolean}
     */
    async validateUserPermissionsForAllPermissions(
        userPermissions: Gibbon | Array<number> | Buffer,
        permissions: Gibbon | Array<number> | Buffer
    ) {
        const userPermissionsGibbon =
            this.ensurePermissionGibbon(userPermissions);
        const permissionsGibbon = this.ensurePermissionGibbon(permissions);
        return userPermissionsGibbon.hasAllFromGibbon(permissionsGibbon);
    }

    /**
     * Given a set of permissions, validate if it has ANY of these given permissions set
     * @param {Gibbon | Array<number> | Buffer} userPermissions - User permissions
     * @param {Gibbon | Array<number> | Buffer} permissions - To compare with
     * @returns {boolean}
     */
    async validateUserPermissionsForAnyPermissions(
        userPermissions: Gibbon | Array<number> | Buffer,
        permissions: Gibbon | Array<number> | Buffer
    ) {
        const userPermissionsGibbon =
            this.ensurePermissionGibbon(userPermissions);
        const permissionsGibbon = this.ensurePermissionGibbon(permissions);
        return userPermissionsGibbon.hasAnyFromGibbon(permissionsGibbon);
    }

    /**
     * Queries database if given groups are indeed allocated (possible to validate the non allocated ones)
     * @param {Gibbon | Array<number> | Buffer} groups
     * @param {boolean} allocated=true search for allocated or non allocated
     * @returns {Promise<boolean>}
     */
    async validateAllocatedGroups(
        groups: Gibbon | Array<number> | Buffer,
        allocated = true
    ): Promise<boolean> {
        const groupPositions =
            this.ensureGroupGibbon(groups).getPositionsArray();

        const query = {
            [this.config.dbStructure.group.fields.gibbonGroupPosition]: {
                $in: groupPositions,
            },
        };
        const allocatedCriteria = {
            [this.config.dbStructure.group.fields.gibbonIsAllocated]: allocated
                ? true
                : { $ne: true },
        };

        const count = await this.dbCollection.group.countDocuments({
            ...query,
            ...allocatedCriteria,
        });
        return count === groupPositions.length;
    }

    /**
     * Queries database if given permissions are indeed allocated (possible to validate the non allocated ones)
     * @param {Gibbon | Array<number> | Buffer} permissions
     * @returns {Promise<boolean>}
     */
    async validateAllocatedPermission(
        permissions: Gibbon | Array<number> | Buffer,
        allocated = true
    ): Promise<boolean> {
        const permissionPositions =
            this.ensurePermissionGibbon(permissions).getPositionsArray();

        const query = {
            [this.config.dbStructure.permission.fields
                .gibbonPermissionPosition]: {
                $in: permissionPositions,
            },
        };

        const allocatedCriteria = {
            [this.config.dbStructure.permission.fields.gibbonIsAllocated]:
                allocated ? true : { $ne: true },
        };

        const count = await this.dbCollection.permission.countDocuments({
            ...query,
            ...allocatedCriteria,
        });
        return count === permissionPositions.length;
    }
    /**
     * Retrieve users and their current group membership, patch given groups and update their aggregated permissions
     * @param {Filter<Document>} filter
     * @param {Array<number>} groups
     */
    async subscribeUsersToGroups(
        filter: Filter<Document>,
        groups: Gibbon | Array<number> | Buffer,
        options?: FindOptions<Document>
    ): Promise<void> {
        const groupsGibbon = this.ensureGroupGibbon(groups);
        const permissionsGibbon = await this.getPermissionsGibbonForGroups(
            groupsGibbon
        );

        const valid = await this.validateAllocatedGroups(groupsGibbon);

        if (!valid) {
            throw new Error(
                `Suggested groups aren't valid (not allocated): ${groupsGibbon.getPositionsArray()}`
            );
        }

        const userUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        const userCursor = this.dbCollection.user.find(filter, options);

        for await (const user of userCursor) {
            const { buffer: groupsBuffer } =
                user[this.config.dbStructure.user.fields.groupsGibbon];
            const { buffer: permissionsBuffer } =
                user[this.config.dbStructure.user.fields.permissionsGibbon];

            const updatePromise = this.dbCollection.user.updateOne(user, {
                $set: {
                    [this.config.dbStructure.user.fields.groupsGibbon]:
                        Gibbon.decode(groupsBuffer)
                            .setAllFromPositions(
                                groupsGibbon.getPositionsArray()
                            )
                            .encode(),
                    [this.config.dbStructure.user.fields.permissionsGibbon]:
                        Gibbon.decode(permissionsBuffer)
                            .mergeWithGibbon(permissionsGibbon)
                            .encode(),
                },
            });

            userUpdateQueue.add(async () => updatePromise);
            // Throttle queue
            if (userUpdateQueue.size > userUpdateQueue.concurrency) {
                await userUpdateQueue.onSizeLessThan(
                    Math.ceil(userUpdateQueue.concurrency / 2)
                );
            }
        }

        await Promise.all([
            // Wait until queue is done executing
            userUpdateQueue.onIdle(),
            // Close cursors gracefully
            userCursor.close(),
        ]);
    }
}
