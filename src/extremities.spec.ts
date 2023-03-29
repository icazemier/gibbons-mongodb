import { expect } from 'chai';
import { Collection, MongoClient } from 'mongodb';
import { GibbonsMongoDb } from './gibbons-mongo-db.js';
import { MongoDbSeeder } from './seeder.js';
import { ConfigLoader } from './config.js';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';
import {
    seedTestFixtures,
    seedUserTestFixtures,
    tearDownGroupTestFixtures,
    tearDownPermissionTestFixtures,
    tearDownUserTestFixtures,
} from '../test/helper/seeders.js';

import {
    TestGroup,
    TestPermission,
    TestUser,
} from '../test/interfaces/test-interfaces.js';
import { Config } from './interfaces/index.js';

describe('Explore the outer rims of permission / groups', () => {
    let mongoDbAdapter: GibbonsMongoDb;
    let mongoClient: MongoClient;
    let dbCollection: {
        user: Collection<TestUser>;
        group: Collection<TestGroup>;
        permission: Collection<TestPermission>;
    };
    let config: Config;

    before(async () => {
        mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
        config = await ConfigLoader.load('gibbons-mongodb-sample');

        dbCollection = {
            user: mongoClient
                .db(config.dbStructure.user.dbName)
                .collection<TestUser>(config.dbStructure.user.collectionName),
            group: mongoClient
                .db(config.dbStructure.group.dbName)
                .collection<TestGroup>(config.dbStructure.group.collectionName),
            permission: mongoClient
                .db(config.dbStructure.permission.dbName)
                .collection<TestPermission>(
                    config.dbStructure.permission.collectionName
                ),
        };
        const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
        await mongoDbSeeder.initialise();

        mongoDbAdapter = new GibbonsMongoDb(MongoDbTestServer.uri, config);
        await mongoDbAdapter.initialize();

        // Test fixtures
        await seedTestFixtures(mongoClient, config);
    });

    beforeEach(async () => {
        try {
            await seedUserTestFixtures(mongoClient, config);
        } catch (error) {
            if (error instanceof Error) {
                console.error(error.message);
            }
        }
    });

    afterEach(async () => {
        await tearDownUserTestFixtures(mongoClient, config);
    });

    after(async () => {
        await tearDownGroupTestFixtures(mongoClient, config);
        await tearDownPermissionTestFixtures(mongoClient, config);
        await mongoClient.close();
    });

    describe('No permissions left', () => {
        before(async () => {
            // Set all permissions as allocated
            await dbCollection.permission.updateMany(
                {},
                { $set: { gibbonIsAllocated: true } }
            );

            // Set all groups as allocated
            await dbCollection.group.updateMany(
                {},
                { $set: { gibbonIsAllocated: true } }
            );
        });

        it(`Try to allocate a permission, but there isn't any left`, async () => {
            const permission = {
                name: 'Where no man has gone before',
            } as TestPermission;

            const throwsError = async () =>
                mongoDbAdapter.allocatePermission(permission);

            await expect(throwsError()).to.be.rejectedWith(
                'Not able to allocate permission, seems all permissions are allocated'
            );
        });

        it(`Try to allocate a group, but there isn't any left`, async () => {
            const data = {
                name: 'Where no man has gone before',
            } as TestGroup;
            const throwsError = async () => mongoDbAdapter.allocateGroup(data);
            await expect(throwsError()).to.be.rejectedWith(
                'Not able to allocate group, seems all groups are allocated'
            );
        });
    });
});
