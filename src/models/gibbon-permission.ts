import { Gibbon } from "@icazemier/gibbons";
import { Collection, FindOneAndUpdateOptions, MongoClient } from "mongodb";
import { Config } from "interfaces/config.js";
import { IGibbonPermission } from "interfaces/gibbon-permission.js";
import { GibbonModel } from "./gibbon-model.js";

export class GibbonPermission extends GibbonModel {
    protected dbCollection: Collection<IGibbonPermission>;

    static byteLength = 256;

    constructor(mongoClient: MongoClient, config: Config) {
        super(mongoClient, config);
        const { dbStructure, permissionByteLength } = config;
        const { dbName, collection } = dbStructure.permission;
        GibbonPermission.byteLength = permissionByteLength;

        this.dbCollection = mongoClient.db(dbName).collection(collection);
    }

    /**
     * Knows about the config and creates a Gibbon according to byte length
     */
    public static ensureGibbon(
        positions: Gibbon | Array<number> | Buffer
    ): Gibbon {
        return GibbonModel.ensureGibbon(positions, GibbonPermission.byteLength);
    }

    /**
     * Allocates a new permission with any desireable document structure
     * It searches for the first available non allocated permission and allocates it,
     * and stores additional given data
     */
    async allocate<T>(data: T): Promise<IGibbonPermission> {
        // Query fo a non allocated permission
        const filter = {
            gibbonIsAllocated: false,
        };
        // Sort, get one from the beginning
        const options = {
            returnDocument: "after",
            sort: ["gibbonPermissionPosition", 1],
        } as FindOneAndUpdateOptions;
        // Prepare an update, ensure we allocate
        const update = {
            $set: {
                ...data,
                gibbonIsAllocated: true,
            },
        };
        const { value: permission } = await this.dbCollection.findOneAndUpdate(
            filter,
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
     */
    async deallocate(permissions: Gibbon): Promise<void> {
        // First get the permissions themselves in a cursor
        const permissionCursor = this.dbCollection.find({
            gibbonPermissionPosition: {
                $in: permissions.getPositionsArray(),
            },
        });

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
                }
            );
        }
        await permissionCursor.close();
    }

    /**
     * Queries database if given permissions are indeed allocated (possible to validate the non allocated ones)
     */
    public async validate(
        permissions: Gibbon,
        allocated = true
    ): Promise<boolean> {
        const permissionPositions = permissions.getPositionsArray();

        const filter = {
            gibbonPermissionPosition: {
                $in: permissionPositions,
            },
            gibbonIsAllocated: allocated ? true : { $ne: true },
        };

        const count = await this.dbCollection.countDocuments(filter);
        return count === permissionPositions.length;
    }
}
