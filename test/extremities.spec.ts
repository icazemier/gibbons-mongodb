import { expect } from "chai";
import { MongoClient } from "mongodb";
import { MongoDBAdapter } from "../src/mongo-db-adapter.js";
import { MongoDbSeeder } from "../src/mongo-db-seeder.js";
import { ConfigLoader } from "../src/config.js";
import { MongoDbTestServer } from "./helper/mongodb-test-server.js";
import { seedTestFixtures } from "./helper/seeders.js";
import { DbCollection } from '../src/types.js';

describe("Explore the outer rims of permission / groups", () => {
    let mongoDbAdapter: MongoDBAdapter;
    let mongoClient: MongoClient;
    let dbCollection: DbCollection;

    before(async () => {
        mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
        const config = await ConfigLoader.load("gibbons-mongodb-sample");

        const user = mongoClient
            .db(config.dbStructure.user.dbName)
            .collection(config.dbStructure.user.collection);
        const group = mongoClient
            .db(config.dbStructure.group.dbName)
            .collection(config.dbStructure.group.collection);
        const permission = mongoClient
            .db(config.dbStructure.permission.dbName)
            .collection(config.dbStructure.permission.collection);

        dbCollection = { user, group, permission } as DbCollection;

        const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
        await mongoDbSeeder.initialise();

        mongoDbAdapter = new MongoDBAdapter(mongoClient, config);

        // Test fixtures
        await seedTestFixtures(mongoClient, config);
    });

    after(async () => {
        await Promise.all([
            dbCollection.permission.drop({}),
            dbCollection.group.drop({}),
            dbCollection.user.drop({}),
        ]);
        await mongoClient.close();
    });

    describe("No permissions left", () => {
        before(async () => {
            // Set all permissions as allocated
            await dbCollection.permission.updateMany(
                {},
                { $set: { gibbonIsAllocated: true } }
            );

            // Set all permissions as allocated
            await dbCollection.group.updateMany(
                {},
                { $set: { gibbonIsAllocated: true } }
            );
        });

        it(`Try to allocate a permission, but there isn't any left`, async () => {
            const throwsError = async () =>
                mongoDbAdapter.allocatePermission({
                    name: "Where no man has gone before",
                });

            await expect(throwsError()).to.be.rejectedWith(
                "Not able to allocate permission, seems all permissions are allocated"
            );
        });

        it(`Try to allocate a group, but there isn't any left`, async () => {
            const throwsError = async () =>
                mongoDbAdapter.allocateGroup({
                    name: "Where no man has gone before",
                });
            await expect(throwsError()).to.be.rejectedWith(
                "Not able to allocate group, seems all groups are allocated"
            );
        });
    });
});
