import { MongoClient } from 'mongodb';
import { Gibbon } from '@icazemier/gibbons';
import { Config, DbCollection } from 'interfaces/config.js';
import {
    IGibbonGroup,
    IGibbonPermission,
    IGibbonUser,
} from 'interfaces/index.js';
import { Utils } from './utils.js';

/**
 * This class is meant to be used when one needs to prepare the Mongo Database with groups and permissions
 * @class MongoDbSeeder
 */
export class MongoDbSeeder {
    public readonly config: Config;
    public readonly dbCollection!: DbCollection;

    constructor(mongoClient: MongoClient, config: Config) {
        // map collections for convenience
        const user = mongoClient
            .db(config.dbStructure.user.dbName)
            .collection<IGibbonUser>(config.dbStructure.user.collectionName);
        const group = mongoClient
            .db(config.dbStructure.group.dbName)
            .collection<IGibbonGroup>(config.dbStructure.group.collectionName);
        const permission = mongoClient
            .db(config.dbStructure.permission.dbName)
            .collection<IGibbonPermission>(
                config.dbStructure.permission.collectionName
            );

        this.config = config;
        this.dbCollection = { user, group, permission };
    }

    /**
     * Ensures the "group" collection is populated containing non-allocated groups.
     * It uses a `sequenceGenerator`, which just generates a sequence from 1-n to ensure a
     * unique position for each group
     * @private
     */
    protected async populateGroups(): Promise<void> {
        for await (const seq of Utils.sequenceGenerator(
            this.config.groupByteLength * 8
        )) {
            // Prepare data
            const data = {
                permissionsGibbon: Gibbon.create(
                    this.config.groupByteLength
                ).encode() as Buffer,
                gibbonGroupPosition: seq as number,
                gibbonIsAllocated: false,
            };

            await this.dbCollection.group.insertOne(data);
        }
    }

    /**
     * Ensures the "permission" collection is populated containing non-allocated permissions.
     * It uses a "sequenceGenerator", which just generates a sequence from 1-n to ensure a
     * unique position for eacht permission
     * @private
     */
    private async populatePermissions(): Promise<void> {
        for await (const seq of Utils.sequenceGenerator(
            this.config.permissionByteLength * 8
        )) {
            // Prepare data
            const data = {
                gibbonPermissionPosition: seq as number,
                gibbonIsAllocated: false,
            };

            await this.dbCollection.permission.insertOne(data);
        }
    }

    /**
     * initialise, which does the following:
     * - Initializes collections from config
     * - Double checks if db structure is not settled already
     * - If so, don't create it
     * - Else creates groups and permissions collections with non-allocated entries
     * @returns {Promise<void>}
     */
    async initialise(): Promise<void> {
        return this.populateGroupsAndPermissions();
    }

    /**
     * This ensures we pre-populate the database collections with groups and permissions ensuring we've got the sequence in order
     * When called multiple times, we skip seeding
     * @returns {Promise<void>}
     */
    async populateGroupsAndPermissions(): Promise<void> {
        const countGroups = this.dbCollection.group
            .find(
                {
                    gibbonIsAllocated: { $exists: true },
                },
                { limit: 1 }
            )
            .count();
        const countPermissions = this.dbCollection.permission
            .find(
                {
                    gibbonIsAllocated: { $exists: true },
                },
                { limit: 1 }
            )
            .count();
        const [count1, count2] = await Promise.all([
            countGroups,
            countPermissions,
        ]);

        if ((count1 | count2) !== 0x0) {
            throw new Error(
                `Called populateGroupsAndPermissions, but permissions and groups seem to be populated already`
            );
        }

        await Promise.all([this.populateGroups(), this.populatePermissions()]);
    }
}
