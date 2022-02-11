import { expect } from 'chai';
import { MongoClient } from 'mongodb';
import {
    seedTestFixtures,
    seedUserTestFixtures,
    tearDownGroupTestFixtures,
    tearDownPermissionTestFixtures,
    tearDownUserTestFixtures,
} from '../test/helper/seeders.js';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';

import { ConfigLoader } from '../src/config.js';
import { MongoDbSeeder } from '../src/seeder.js';
import { Config } from './interfaces/index.js';

describe('Unhappy flows mongo db seeder', () => {
    let mongoClient: MongoClient;
    let mongoDbSeeder: MongoDbSeeder;
    let config: Config;

    before(async () => {
        mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
        config = await ConfigLoader.load('gibbons-mongodb-sample');

        mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
        await mongoDbSeeder.initialise();
        // Test fixtures
        await seedTestFixtures(mongoClient, config);
    });

    beforeEach(async () => {
        await seedUserTestFixtures(mongoClient, config);
    });
    afterEach(async () => {
        await tearDownUserTestFixtures(mongoClient, config);
    });

    after(async () => {
        await tearDownGroupTestFixtures(mongoClient, config);
        await tearDownPermissionTestFixtures(mongoClient, config);
        await mongoClient.close();
    });

    it(`Try to purposefully seed data again.`, async () => {
        const throwsError = async () => mongoDbSeeder.initialise();

        await expect(throwsError()).to.be.rejectedWith(
            'Called populateGroupsAndPermissions, but permissions and groups seem to be populated already'
        );
    });
});
