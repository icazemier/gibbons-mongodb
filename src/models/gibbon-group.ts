import { Gibbon } from "@icazemier/gibbons";
import {
    Binary,
    Collection,
    FindCursor,
    FindOneAndUpdateOptions,
    MongoClient,
} from "mongodb";
import PQueue from "p-queue";
import { Config } from "interfaces/config.js";
import { IGibbonGroup } from "interfaces/gibbon-group.js";
import { GibbonModel } from "./gibbon-model.js";
import { GibbonPermission } from "./gibbon-permission.js";

export class GibbonGroup extends GibbonModel {
    protected dbCollection: Collection<IGibbonGroup>;

    static byteLength = 256;

    constructor(mongoClient: MongoClient, config: Config) {
        super(mongoClient, config);
        const { dbName, collection } = config.dbStructure.group;
        GibbonGroup.byteLength = config.groupByteLength;

        this.dbCollection = mongoClient.db(dbName).collection(collection);
    }

    /**
     * Accepts a MongoDB Document and maps `permissionsGibbon` from Binary to Gibbon
     *
     * @example
     *
     * ```
     * // Pseudo code:
     * const group = {
     *    _id: ObjectId
     *    permissionsGibbon: Binary
     * };
     *
     * const transformed = GibbonGroup.mapPermissionsBinaryToGibbon(group);
     *
     * // mapped = {
     * //   _id: ObjectId
     * //   permissionsGibbon: Gibbon
     * // }
     *
     * ```
     */
    protected static mapPermissionsBinaryToGibbon<T extends IGibbonGroup>(
        group: T
    ): T {
        const transformedGroup = { ...group };
        const { buffer: permissionBuffer } =
            transformedGroup.permissionsGibbon as Binary;
        transformedGroup.permissionsGibbon = Gibbon.decode(permissionBuffer);
        return { ...transformedGroup };
    }

    /**
     * Creates a Gibbon according to configured byte length
     */
    public static ensureGibbon(
        positions: Gibbon | Array<number> | Buffer
    ): Gibbon {
        return GibbonModel.ensureGibbon(positions, GibbonGroup.byteLength);
    }

    /**
     * Queries database for given groups if indeed allocated
     * (possible to validate the non allocated ones)
     */
    public async validate(groups: Gibbon, allocated = true): Promise<boolean> {
        const groupPositions = groups.getPositionsArray();

        const filter = {
            gibbonGroupPosition: {
                $in: groupPositions,
            },
            gibbonIsAllocated: allocated ? true : { $ne: true },
        };

        const count = await this.dbCollection.countDocuments(filter);
        return count === groupPositions.length;
    }

    /**
     * Fetches aggregated permissions from groups
     * (It fetches all given groups and collects subscribed permissions)
     * Useful to store at the user itself for fast access
     */
    async getPermissionsGibbonForGroups(groups: Gibbon): Promise<Gibbon> {
        const groupPositions = groups.getPositionsArray();

        const filter = {
            gibbonGroupPosition: {
                $in: groupPositions,
            },
        };

        const projection = {
            _id: 0,
            permissionsGibbon: 1,
        };

        // Get FindCursor instance for groups groups
        const groupCursor = this.dbCollection.find(filter, { projection });

        // Create fresh permissions space as we're rebuilding permissions scratch
        const permissionGibbon = Gibbon.create(GibbonPermission.byteLength);
        // Iterate through all these specific groups and collect permissions
        for await (const group of groupCursor) {
            const { buffer } = group.permissionsGibbon as Binary;
            permissionGibbon.mergeWithGibbon(Gibbon.decode(buffer));
        }
        return permissionGibbon;
    }

    /**
     * Find groups by given Gibbon
     */
    public find(groups: Gibbon): FindCursor<IGibbonGroup> {
        const filter = {
            gibbonGroupPosition: {
                $in: groups.getPositionsArray(),
            },
        };

        return this.dbCollection
            .find(filter)
            .map((group) => GibbonGroup.mapPermissionsBinaryToGibbon(group));
    }

    /**
     * Find allocated groups where permissions are subscribed
     */
    findByPermissions(
        permissions: Gibbon,
        allocated = true
    ): FindCursor<IGibbonGroup> {
        const filter = {
            gibbonIsAllocated: allocated || { $ne: true },
            permissionsGibbon: {
                $bitsAnySet: permissions.encode() as Buffer,
            },
        };

        return this.dbCollection
            .find(filter)
            .map((group) => GibbonGroup.mapPermissionsBinaryToGibbon(group));
    }

    /**
     * Search for the first available non allocated group, allocates it,
     * with additional given data
     */
    async allocate<T>(data: T): Promise<IGibbonGroup> {
        // Query for a non allocated group
        const filter = {
            gibbonIsAllocated: false,
        };

        // Sort, get one from the beginning
        const options = {
            returnDocument: "after",
            sort: ["gibbonGroupPosition", 1],
        } as FindOneAndUpdateOptions;

        // Prepare an update, ensure we allocate
        const update = {
            $set: {
                ...data,
                gibbonIsAllocated: true,
                permissionsGibbon: Gibbon.create(
                    GibbonGroup.byteLength
                ).encode() as Buffer,
            },
        };

        const { value: group } = await this.dbCollection.findOneAndUpdate(
            filter,
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
     * Searches for permissions and sets them to logical `false`
     */
    async unsetPermissions(permissionsToUnset: Gibbon): Promise<void> {
        const permissionsBufferToUnset = permissionsToUnset.encode() as Buffer;
        const permissionPositionsToUnset =
            permissionsToUnset.getPositionsArray();

        const groupUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        // Loop through all groups check if there are any positions, then
        // be sure to unset these permissions
        const filter = {
            permissionsGibbon: {
                $bitsAnySet: permissionsBufferToUnset,
            },
        };

        const groupCursor = this.dbCollection.find(filter);
        for await (const group of groupCursor) {
            const { gibbonGroupPosition } = group;
            const { buffer: permissionBuffer } =
                group.permissionsGibbon as Binary;

            const permissionsGibbon = Gibbon.decode(permissionBuffer)
                .unsetAllFromPositions(permissionPositionsToUnset)
                .encode() as Buffer;

            const groupFilter = {
                gibbonGroupPosition,
            };
            // Update permissions in this group
            const updatePromise = this.dbCollection.updateOne(groupFilter, {
                $set: {
                    permissionsGibbon,
                },
            });
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
    }

    /**
     * Resets default values to each given group, then
     * it removes membership from each user for these groups
     */
    async deallocate(groups: Gibbon): Promise<void> {
        const positionsToDeallocate = groups.getPositionsArray();

        const filter = {
            gibbonGroupPosition: {
                $in: positionsToDeallocate,
            },
        };

        const projection = {
            gibbonGroupPosition: 1,
        };

        const groupCursor = this.dbCollection.find(filter, { projection });

        const groupReplaceOneQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        for await (const group of groupCursor) {
            // Fetch position for update
            const { gibbonGroupPosition } = group;

            // Prepare to reset values to defaults
            const queueTask = this.dbCollection.replaceOne(
                {
                    gibbonGroupPosition,
                },
                {
                    // Reset to default values
                    gibbonGroupPosition,
                    // New Gibbon, no permissions set
                    permissionsGibbon: Gibbon.create(GibbonGroup.byteLength),
                    // Set to be available for allocations again
                    gibbonIsAllocated: false,
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
    }

    /**
     * Search for groups and set their permissions
     * We need to revisit the users matching these groups
     * and update their permissions also
     */
    async subscribePermissions(
        groups: Gibbon,
        permissions: Gibbon
    ): Promise<void> {
        const groupUpdateQueue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        const groupCursor = this.dbCollection.find(
            {
                gibbonGroupPosition: { $in: groups.getPositionsArray() },
            },
            {
                projection: {
                    permissionsGibbon: 1,
                },
            }
        );

        for await (const group of groupCursor) {
            const { permissionsGibbon, gibbonGroupPosition } = group;
            const { buffer: permissionsBuffer } = permissionsGibbon as Binary;

            const updatePromise = this.dbCollection.updateOne(
                { gibbonGroupPosition },
                {
                    $set: {
                        permissionsGibbon: Gibbon.decode(permissionsBuffer)
                            .mergeWithGibbon(permissions)
                            .encode() as Buffer,
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
    }
}
