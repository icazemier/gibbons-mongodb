import { Gibbon } from "@icazemier/gibbons";
import { Document, Filter, FindCursor, MongoClient } from "mongodb";

import {
    Config,
    IGibbonGroup,
    IGibbonPermission,
    IGibbonUser,
    IPermissionsResource,
} from "./interfaces/index.js";

import { GibbonUser, GibbonGroup, GibbonPermission } from "./models/index.js";

/**
 * Class which does all the "heavy" lifting against MongDB
 *
 */
export class GibbonsMongoDb implements IPermissionsResource {
    protected gibbonGroup: GibbonGroup;
    protected gibbonPermission: GibbonPermission;
    protected gibbonUser: GibbonUser;

    /**
     *
     * @param mongoClient
     * @param config
     */
    constructor(mongoClient: MongoClient, config: Config) {
        this.gibbonUser = new GibbonUser(mongoClient, config);
        this.gibbonPermission = new GibbonPermission(mongoClient, config);
        this.gibbonGroup = new GibbonGroup(mongoClient, config);
    }

    /**
     * Fetches aggregated permissions from groups
     * (Useful to store at the user itself for fast access)
     *
     * @param groups
     */
    async getPermissionsGibbonForGroups(
        groups: Gibbon | Array<number> | Buffer
    ): Promise<Gibbon> {
        return this.gibbonGroup.getPermissionsGibbonForGroups(
            GibbonGroup.ensureGibbon(groups)
        );
    }

    /**
     * Convenience function to retrieve group documents
     *
     * @param groups Contains group positions to query for
     * @returns A MongoDB FindCursor
     */
    public findGroups(
        groups: Gibbon | Array<number> | Buffer
    ): FindCursor<IGibbonGroup> {
        return this.gibbonGroup.find(GibbonGroup.ensureGibbon(groups));
    }

    /**
     * Find allocated groups where permissions are subscribed
     *
     * @param permissions Permissions to query for
     * @param allocated Match for allocated (default) or non allocated
     * @returns groups Cursor
     */
    findGroupsByPermissions(
        permissions: Gibbon | Array<number> | Buffer,
        allocated = true
    ): FindCursor<IGibbonGroup> {
        return this.gibbonGroup.findByPermissions(
            GibbonGroup.ensureGibbon(permissions),
            allocated
        );
    }

    /**
     * Find users where permissions are subscribed
     *
     * @param permissions Permissions to query for
     * @returns users Cursor
     */
    findUsersByPermissions(
        permissions: Gibbon | Array<number> | Buffer
    ): FindCursor<IGibbonUser> {
        return this.gibbonUser.findByPermissions(
            GibbonPermission.ensureGibbon(permissions)
        );
    }

    /**
     * Find users where groups are subscribed
     *
     * @param groups Groups to query for
     * @returns users Cursor
     */
    findUsersByGroups(
        groups: Gibbon | Array<number> | Buffer
    ): FindCursor<IGibbonUser> {
        return this.gibbonUser.findByGroups(GibbonGroup.ensureGibbon(groups));
    }

    /**
     * Allocates a new permission with any desireable document structure
     * It searches for the first available non allocated permission and allocates it,
     * and stores additional given data
     *
     * @param data Anything really, at least MongoDB compatible
     * @returns Created permission
     */
    async allocatePermission<T>(data: T): Promise<IGibbonPermission> {
        return this.gibbonPermission.allocate(data);
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
        const permissionGibbon = GibbonGroup.ensureGibbon(permissions);
        await this.gibbonPermission.deallocate(permissionGibbon);
        await this.gibbonGroup.unsetPermissions(permissionGibbon);
        await this.gibbonUser.unsetPermissions(permissionGibbon);
    }

    /**
     * Search for the first available non allocated group, then allocates it,
     * and stores the given additional/desireable data
     *
     * @example
     *
     * Lets assume, position 1 and 2 aren't allocated, but 3 is. We should expect the 3rd time, to allocate position 4
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
    async allocateGroup<T>(data: T): Promise<IGibbonGroup> {
        return this.gibbonGroup.allocate(data);
    }

    /**
     * Resets default values to each given group, then
     * it removes membership from each user for these groups
     *
     * @param { Gibbon | Array<number> | Buffer} groups - Group positions collection
     * @returns {Promise<void>}
     */
    async deallocateGroups(
        groups: Gibbon | Array<number> | Buffer
    ): Promise<void> {
        const groupsGibbon = GibbonGroup.ensureGibbon(groups);
        await this.gibbonGroup.deallocate(groupsGibbon);
        await this.gibbonUser.unsetGroups(groupsGibbon, this);
    }

    /**
     * Given a set of user groups, validate if they have ALL given groups set
     *
     * @param userGroups User groups
     * @param groups Groups to compare with
     * @returns {boolean}
     */
    static validateUserGroupsForAllGroups(
        userGroups: Gibbon | Array<number> | Buffer,
        groups: Gibbon | Array<number> | Buffer
    ): boolean {
        const userGroupsGibbon = GibbonGroup.ensureGibbon(userGroups);
        const groupsGibbon = GibbonGroup.ensureGibbon(groups);
        return userGroupsGibbon.hasAllFromGibbon(groupsGibbon);
    }

    /**
     * Given a set of user groups, validate if they have ANY of given groups set
     *
     * @param userGroups User groups
     * @param groups Groups to compare with
     */
    static validateUserGroupsForAnyGroups(
        userGroups: Gibbon | Array<number> | Buffer,
        groups: Gibbon | Array<number> | Buffer
    ) {
        const userGroupsGibbon = GibbonGroup.ensureGibbon(userGroups);
        const groupsGibbon = GibbonGroup.ensureGibbon(groups);
        return userGroupsGibbon.hasAnyFromGibbon(groupsGibbon);
    }

    /**
     * Given a set of user permissions, validate if this has ALL of given permissions set
     *
     * @param userPermissions User permissions
     * @param permissions Permissions to compare with
     */
    async validateUserPermissionsForAllPermissions(
        userPermissions: Gibbon | Array<number> | Buffer,
        permissions: Gibbon | Array<number> | Buffer
    ) {
        const userPermissionsGibbon =
            GibbonPermission.ensureGibbon(userPermissions);
        const permissionsGibbon = GibbonPermission.ensureGibbon(permissions);
        return userPermissionsGibbon.hasAllFromGibbon(permissionsGibbon);
    }

    /**
     * Given a set of permissions, validate if it has ANY of these given permissions set
     *
     * @paramuserPermissions User permissions
     * @param permissions To compare with
     */
    public async validateUserPermissionsForAnyPermissions(
        userPermissions: Gibbon | Array<number> | Buffer,
        permissions: Gibbon | Array<number> | Buffer
    ): Promise<boolean> {
        const userPermissionsGibbon =
            GibbonPermission.ensureGibbon(userPermissions);
        const permissionsGibbon = GibbonPermission.ensureGibbon(permissions);
        return userPermissionsGibbon.hasAnyFromGibbon(permissionsGibbon);
    }

    /**
     * Queries database if given groups are indeed allocated (possible to validate the non allocated ones)
     *
     * @param groups
     * @param allocated=true search for allocated or non allocated
     */
    public async validateAllocatedGroups(
        groups: Gibbon | Array<number> | Buffer,
        allocated = true
    ): Promise<boolean> {
        return this.gibbonGroup.validate(
            GibbonGroup.ensureGibbon(groups),
            allocated
        );
    }

    /**
     * Queries database if given permissions are indeed allocated (possible to validate the non allocated ones)
     *
     * @param permissions
     */
    public async validateAllocatedPermissions(
        permissions: Gibbon | Array<number> | Buffer,
        allocated = true
    ): Promise<boolean> {
        return this.gibbonPermission.validate(
            GibbonPermission.ensureGibbon(permissions),
            allocated
        );
    }

    /**
     * Retrieve users and their current group membership, patch given groups and update their aggregated permissions
     * @param filter
     * @param groups
     */
    async subscribeUsersToGroups(
        filter: Filter<Document>,
        groups: Gibbon | Array<number> | Buffer
    ): Promise<void> {
        const groupsGibbon = GibbonGroup.ensureGibbon(groups);

        const valid = await this.gibbonGroup.validate(groupsGibbon);

        if (!valid) {
            throw new Error(
                `Suggested groups aren't valid (not allocated): ${groupsGibbon.getPositionsArray()}`
            );
        }

        // First we need to know which permissions belong to these given groups
        const permissionsGibbon =
            await this.gibbonGroup.getPermissionsGibbonForGroups(groupsGibbon);
        // Delegate the search for users and subscribe them
        await this.gibbonUser.subscribeToGroupsAndPermissions(
            filter,
            groupsGibbon,
            permissionsGibbon
        );
    }

    /**
     * Subscribe (set) permissions to given groups
     * Users subscribed to these groups need to be updated with these additional permissions
     * @param groups
     * @param permissions
     * @throws Error when given groups or permissions are not allocated
     */
    async subscribePermissionsToGroups(
        groups: Gibbon | Array<number> | Buffer,
        permissions: Gibbon | Array<number> | Buffer
    ): Promise<void> {
        const groupsGibbon = GibbonGroup.ensureGibbon(groups);
        const permissionGibbon = GibbonPermission.ensureGibbon(permissions);

        // Validate to ensure groups and permissions are allocated
        const [permissionsValid, groupsValid] = await Promise.all([
            this.gibbonPermission.validate(permissionGibbon),
            this.gibbonGroup.validate(groupsGibbon),
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
            permissionGibbon
        );

        // Ensure users subscribed to these groups are updated with these permissions
        await this.gibbonUser.subscribeToPermissionsForGroups(
            groupsGibbon,
            permissionGibbon
        );
    }
}
