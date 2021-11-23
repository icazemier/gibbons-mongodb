import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import {
  tearDownGroupTestFixtures,
  tearDownPermissionTestFixtures,
} from '../test/helper/seeders.js';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';
import { ConfigLoader } from './config.js';
import { MongoDbSeeder } from './seeder.js';
import { Config } from './interfaces/index.js';

describe('Unhappy flows mongo db seeder', () => {
  let mongoClient: MongoClient;
  let mongoDbSeeder: MongoDbSeeder;
  let config: Config;

  beforeAll(async () => {
    mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
    config = await ConfigLoader.load('gibbons-mongodb-sample');

    mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
    await mongoDbSeeder.initialize();
  });

  afterAll(async () => {
    await tearDownGroupTestFixtures(mongoClient, config);
    await tearDownPermissionTestFixtures(mongoClient, config);
    await mongoClient.close();
  });

  it('Try to purposefully seed data again.', async () => {
    await expect(mongoDbSeeder.initialize()).rejects.toThrow(
      'Called populateGroupsAndPermissions, but permissions and groups seem to be populated already'
    );
  });
});
