import { Gibbon } from '@icazemier/gibbons';
import {
    Binary,
    Collection,
    FindCursor,
    FindOneAndUpdateOptions,
    MongoClient,
    UpdateFilter,
} from 'mongodb';
import { Config } from 'interfaces/config.js';
import { IGibbonGroup } from 'interfaces/gibbon-group.js';
import { GibbonModel } from './gibbon-model.js';
import { GibbonLike } from 'interfaces/index.js';

export class GibbonGroup extends GibbonModel {
    protected dbCollection!: Collection<IGibbonGroup>;

    constructor(mongoClient: MongoClient, config: Config) {
        const { groupByteLength } = config;
        super(mongoClient, groupByteLength);
    }
    async initialize(structure: {
        dbName: string;
        collectionName: string;
    }): Promise<void> {
        const { dbName, collectionName } = structure;
        this.dbCollection = this.mongoClient
            .db(dbName)
            .collection(collectionName);
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
    ): IGibbonGroup {
        const { buffer: permissionBuffer } = group.permissionsGibbon as Binary;

        const transformedGroup = {
            ...group,
            ...{ permissionsGibbon: Gibbon.decode(permissionBuffer) },
        };
        return transformedGroup;
    }

    /**
     * Queries database for given groups if indeed allocated
     * (possible to validate the non allocated ones)
     */
    public async validate(
        groups: GibbonLike,
        allocated = true
    ): Promise<boolean> {
        const groupPositions = this.ensureGibbon(groups).getPositionsArray();

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
    async getPermissionsGibbonForGroups(groups: GibbonLike): Promise<Gibbon> {
        const groupPositions = this.ensureGibbon(groups).getPositionsArray();

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
        const permissionGibbon = Gibbon.create(this.byteLength);
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
    public find(groups: GibbonLike): FindCursor<IGibbonGroup> {
        const filter = {
            gibbonGroupPosition: {
                $in: this.ensureGibbon(groups).getPositionsArray(),
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
        permissions: GibbonLike,
        allocated = true
    ): FindCursor<IGibbonGroup> {
        const $bitsAnySet = this.ensureGibbon(permissions).encode() as Buffer;

        const filter = {
            gibbonIsAllocated: allocated || { $ne: true },
            permissionsGibbon: {
                $bitsAnySet,
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
    async allocate<OmitGibbonGroupPosition>(
        data: OmitGibbonGroupPosition
    ): Promise<IGibbonGroup> {
        // Query for a non allocated group
        const filter = {
            gibbonIsAllocated: false,
        };

        // Sort, get one from the beginning
        const options = {
            returnDocument: 'after',
            sort: ['gibbonGroupPosition', 1],
        } as FindOneAndUpdateOptions;

        // Prepare an update, ensure we allocate
        const $set = {
            ...data,
            gibbonIsAllocated: true,
            permissionsGibbon: Gibbon.create(
                this.byteLength
            ).encode() as Buffer,
        } as UpdateFilter<IGibbonGroup>;

        const { value: group } = await this.dbCollection.findOneAndUpdate(
            filter,
            { $set },
            options
        );
        if (!group) {
            throw new Error(
                'Not able to allocate group, seems all groups are allocated'
            );
        }

        return GibbonGroup.mapPermissionsBinaryToGibbon(group);
    }

    /**
     * Searches for permissions and sets them to logical `false`
     * @param permissionsToUnset
     */
    async unsetPermissions(permissions: GibbonLike): Promise<void> {
        const permissionsToUnset = this.ensureGibbon(permissions);
        const permissionsBufferToUnset = permissionsToUnset.encode() as Buffer;
        const permissionPositionsToUnset =
            permissionsToUnset.getPositionsArray();

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
            await this.dbCollection.updateOne(groupFilter, {
                $set: {
                    permissionsGibbon,
                },
            });
        }
        await groupCursor.close();
    }

    /**
     * Resets default values to each given group, then
     * it removes membership from each user for these groups
     *
     * @param groups
     */
    async deallocate(groups: GibbonLike): Promise<void> {
        const $in = this.ensureGibbon(groups).getPositionsArray();

        const filter = {
            gibbonGroupPosition: {
                $in,
            },
        };

        const projection = {
            gibbonGroupPosition: 1,
        };

        const groupCursor = this.dbCollection.find(filter, { projection });

        for await (const group of groupCursor) {
            // Fetch position for update
            const { gibbonGroupPosition } = group;

            // Prepare to reset values to defaults
            await this.dbCollection.replaceOne(
                {
                    gibbonGroupPosition,
                },
                {
                    // Reset to default values
                    gibbonGroupPosition,
                    // New Gibbon, no permissions set
                    permissionsGibbon: Gibbon.create(this.byteLength),
                    // Set to be available for allocations again
                    gibbonIsAllocated: false,
                }
            );
        }
        await groupCursor.close();
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
        const groupCursor = this.dbCollection.find(
            {
                gibbonGroupPosition: { $in: groups.getPositionsArray() },
            },
            {
                projection: {
                    gibbonGroupPosition: 1,
                    permissionsGibbon: 1,
                },
            }
        );

        for await (const group of groupCursor) {
            const { permissionsGibbon, gibbonGroupPosition } = group;
            const { buffer: permissionsBuffer } = permissionsGibbon as Binary;

            await this.dbCollection.updateOne(
                { gibbonGroupPosition },
                {
                    $set: {
                        permissionsGibbon: Gibbon.decode(permissionsBuffer)
                            .mergeWithGibbon(permissions)
                            .encode() as Buffer,
                    },
                }
            );
        }
        await groupCursor.close();
    }
}
