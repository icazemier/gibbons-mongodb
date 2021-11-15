import { Gibbon } from "@icazemier/gibbons";
import { MongoClient } from "mongodb";
import PQueue from "p-queue";
import { Config, DbCollection } from "types.js";
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
     * Ensures the "group" collection is populated containing non-allocated groups.
     * It uses a `sequenceGenerator`, which just generates a sequence from 1-n to ensure a
     * unique position for each group
     * @private
     */
    protected async populateGroups(): Promise<void> {
        const queue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        for await (const seq of Utils.sequenceGenerator(
            this.config.groupByteLength * 8
        )) {
            // Prepare data
            const data = {
                [this.config.dbStructure.group.fields.permissionsGibbon]:
                    Gibbon.create(this.config.groupByteLength).encode(),
                [this.config.dbStructure.group.fields.gibbonGroupPosition]: seq,
                [this.config.dbStructure.group.fields.gibbonIsAllocated]: false,
            };

            // Push task to queue
            queue.add(async () => this.dbCollection.group.insertOne(data));

            // Throttle traffic towards MongoDB if needed
            if (queue.size > queue.concurrency) {
                await queue.onSizeLessThan(Math.ceil(queue.concurrency / 2));
            }
        }
        // Wait until queue is done executing
        await queue.onIdle();
    }

    /**
     * Ensures the "permission" collection is populated containing non-allocated permissions.
     * It uses a "sequenceGenerator", which just generates a sequence from 1-n to ensure a
     * unique position for eacht permission
     * @private
     */
    private async populatePermissions(): Promise<void> {
        const queue = new PQueue({
            concurrency: this.config.mongoDbMutationConcurrency,
        });

        for await (const seq of Utils.sequenceGenerator(
            this.config.permissionByteLength * 8
        )) {
            // Prepare data
            const data = {
                [this.config.dbStructure.permission.fields
                    .gibbonPermissionPosition]: seq,
                [this.config.dbStructure.permission.fields.gibbonIsAllocated]:
                    false,
            };

            // Push task to queue
            queue.add(async () => this.dbCollection.permission.insertOne(data));

            // Throttle traffic towards MongoDB if needed
            if (queue.size > queue.concurrency) {
                await queue.onSizeLessThan(Math.ceil(queue.concurrency / 2));
            }
        }
        // Wait until queue is done executing
        await queue.onIdle();
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
        const groupPermissionsGibbon =
            this.config.dbStructure.group.fields.permissionsGibbon;
        const gibbonsWasHere =
            (await this.dbCollection.group
                .find({ [groupPermissionsGibbon]: { $exists: true } })
                .count()) > 0;

        if (gibbonsWasHere) {
            console.warn(
                `Called populateGroupsAndPermissions, but permissions and groups seem to be populated already`
            );
            return;
        }

        await Promise.all([this.populateGroups(), this.populatePermissions()]);
    }
}
