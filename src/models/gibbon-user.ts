import { Gibbon } from "@icazemier/gibbons";
import { Binary, Collection, Filter, FindCursor, MongoClient } from "mongodb";
import { IGibbonUser } from "interfaces/gibbon-user.js";
import { IPermissionsResource } from "interfaces/permissions-resource.js";
import { GibbonModel } from "./gibbon-model.js";
import { Config } from "interfaces/config.js";

export class GibbonUser extends GibbonModel {
    protected dbCollection: Collection<IGibbonUser>;

    constructor(mongoClient: MongoClient, config: Config) {
        super(mongoClient, config);
        const { dbName, collection } = config.dbStructure.user;

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
     *    groupsGibbon: Binary
     * };
     *
     * const transformed = GibbonUser.mapPermissionsBinaryToGibbon(group);
     *
     * // mapped = {
     * //   _id: ObjectId
     * //   permissionsGibbon: Gibbon
     * //   groupsGibbon: Gibbon
     * // }
     *
     * ```
     *
     * @param user
     */
    protected static mapPermissionsBinaryToGibbon<T extends IGibbonUser>(
        user: T
    ): IGibbonUser {
        const { buffer: permissionBuffer } = user.permissionsGibbon as Binary;
        const { buffer: groupBuffer } = user.groupsGibbon as Binary;

        return {
            ...user,
            ...{
                permissionsGibbon: Gibbon.decode(permissionBuffer),
                groupsGibbon: Gibbon.decode(groupBuffer),
            },
        };
    }

    /**
     * Tries to fetch users by permissions
     */
    findByPermissions(permissions: Gibbon): FindCursor<IGibbonUser> {
        const $bitsAnySet = permissions.encode() as Buffer;
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
     * Tries to fetch users by groups
     *
     * @see {@link https://mongodb.github.io/node-mongodb-native/4.2/classes/FindCursor.html | FindCursor}
     *
     * @param {Gibbon | Array<number> | Buffer} gibbon - representing groups
     * @returns {FindCursor<Document>} Collection of found users
     */
    findByGroups(groups: Gibbon): FindCursor<IGibbonUser> {
        const filter = {
            groupsGibbon: {
                $bitsAnySet: groups.encode() as Buffer,
            },
        };

        return this.dbCollection
            .find(filter)
            .map((user) => GibbonUser.mapPermissionsBinaryToGibbon(user));
    }

    /**
     * Searches for permissions and sets them to logical `false`
     * @param permissionsToUnset
     */
    async unsetPermissions(permissionsToUnset: Gibbon) {
        const permissionsBufferToUnset = permissionsToUnset.encode() as Buffer;
        const permissionPositionsToUnset =
            permissionsToUnset.getPositionsArray();

        // Loop through all users check if there are any positions, then
        // be sure to unset these permissions
        const userFilter = {
            permissionsGibbon: {
                $bitsAnySet: permissionsBufferToUnset,
            },
        };

        const userCursor = this.dbCollection.find(userFilter);

        for await (const user of userCursor) {
            const { buffer: permissionBuffer } =
                user.permissionsGibbon as Binary;

            const gibbon = Gibbon.decode(
                permissionBuffer
            ).unsetAllFromPositions(permissionPositionsToUnset);

            // Update permissions in this group
            await this.dbCollection.updateOne(user, {
                $set: {
                    permissionsGibbon: gibbon.encode(),
                },
            });
        }
        await userCursor.close();
    }

    /**
     * Search for users subsscribed to these groups, be sure to unset when found.
     * Also ensure corresponding permissions are aligned and stored again
     *
     * @param groups
     * @param permissionsResource
     */
    async unsetGroups(
        groups: Gibbon,
        permissionsResource: IPermissionsResource
    ): Promise<void> {
        const groupsToDeallocateBuffer = groups.encode() as Buffer;
        const positionsToDeallocate = groups.getPositionsArray();

        const filter = {
            groupsGibbon: {
                $bitsAnySet: groupsToDeallocateBuffer,
            },
        };

        const userCursor = this.dbCollection.find(filter);

        for await (const user of userCursor) {
            const { groupsGibbon: groupsGibbonBinary, _id } = user;
            const { buffer } = groupsGibbonBinary as Binary;

            // Unset bit positions
            const groupsGibbon = Gibbon.decode(buffer).unsetAllFromPositions(
                positionsToDeallocate
            );

            // We need to determine permissions from
            // group subscriptions for this user
            // Delegate this to our `permissionsResource`
            const permissionGibbon =
                await permissionsResource.getPermissionsGibbonForGroups(
                    groupsGibbon
                );

            // Update groups and corresponding permissions for this user
            await this.dbCollection.updateOne(
                { _id },
                {
                    $set: {
                        groupsGibbon: groupsGibbon.encode(),
                        permissionsGibbon: permissionGibbon.encode(),
                    },
                }
            );
        }
        await userCursor.close();
    }

    /**
     * Retrieve users and their current group membership, patch given groups and update their aggregated permissions
     * @param {Filter<Document>} filter
     * @param {Array<number>} groups
     */
    async subscribeToGroupsAndPermissions(
        filter: Filter<IGibbonUser>,
        groups: Gibbon,
        permissions: Gibbon
    ): Promise<void> {
        const userCursor = this.dbCollection.find(filter);

        for await (const user of userCursor) {
            const { buffer: groupsBuffer } = user.groupsGibbon as Binary;
            const { buffer: permissionsBuffer } =
                user.permissionsGibbon as Binary;

            await this.dbCollection.updateOne(user, {
                $set: {
                    groupsGibbon: Gibbon.decode(groupsBuffer)
                        .mergeWithGibbon(groups)
                        .encode(),
                    permissionsGibbon: Gibbon.decode(permissionsBuffer)
                        .mergeWithGibbon(permissions)
                        .encode(),
                },
            });
        }
        await userCursor.close();
    }

    /**
     * Find all users subscribed to certain groups and subscribe them to given permissions
     * @param groups
     * @param permissions
     */
    async subscribeToPermissionsForGroups(
        groups: Gibbon,
        permissions: Gibbon
    ): Promise<void> {
        const filter = {
            groupsGibbon: {
                $bitsAnySet: groups.encode() as Buffer,
            },
        };

        const userCursor = this.dbCollection.find(filter, {
            projection: {
                permissionsGibbon: 1,
            },
        });

        for await (const user of userCursor) {
            const { _id, permissionsGibbon } = user;
            const { buffer: permissionsBuffer } = permissionsGibbon as Binary;

            await this.dbCollection.updateOne(
                { _id },
                {
                    $set: {
                        permissionsGibbon: Gibbon.decode(permissionsBuffer)
                            .mergeWithGibbon(permissions)
                            .encode(),
                    },
                }
            );
        }
        await userCursor.close();
    }
}
