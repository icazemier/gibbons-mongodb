import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Collection, MongoClient } from 'mongodb';
import {
  tearDownGroupTestFixtures,
  tearDownPermissionTestFixtures,
} from '../test/helper/seeders.js';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';
import { ConfigLoader } from './config.js';
import { MongoDbSeeder } from './seeder.js';
import { Config, IGibbonGroup, IGibbonPermission } from './interfaces/index.js';

describe('MongoDbSeeder', () => {
  let mongoClient: MongoClient;
  let mongoDbSeeder: MongoDbSeeder;
  let config: Config;
  let groupCollection: Collection<IGibbonGroup>;
  let permissionCollection: Collection<IGibbonPermission>;

  beforeAll(async () => {
    mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
    config = await ConfigLoader.load('gibbons-mongodb-sample');

    mongoDbSeeder = new MongoDbSeeder(mongoClient, config);

    const db = mongoClient.db(config.dbName);
    groupCollection = db.collection<IGibbonGroup>(
      config.dbStructure.group.collectionName
    );
    permissionCollection = db.collection<IGibbonPermission>(
      config.dbStructure.permission.collectionName
    );

    await mongoDbSeeder.initialize();
  });

  afterAll(async () => {
    await tearDownGroupTestFixtures(mongoClient, config);
    await tearDownPermissionTestFixtures(mongoClient, config);
    await mongoClient.close();
  });

  it('creates the expected number of group slots', async () => {
    const count = await groupCollection.countDocuments();
    expect(count).toBe(config.groupByteLength * 8);
  });

  it('creates the expected number of permission slots', async () => {
    const count = await permissionCollection.countDocuments();
    expect(count).toBe(config.permissionByteLength * 8);
  });

  it('creates unique indexes on position fields', async () => {
    const groupIndexes = await groupCollection.indexes();
    const permIndexes = await permissionCollection.indexes();

    const groupPositionIndex = groupIndexes.find(
      (idx) => (idx.key as Record<string, number>).gibbonGroupPosition === 1
    );
    const permPositionIndex = permIndexes.find(
      (idx) =>
        (idx.key as Record<string, number>).gibbonPermissionPosition === 1
    );

    expect(groupPositionIndex).toBeDefined();
    expect(groupPositionIndex?.unique).toBe(true);
    expect(permPositionIndex).toBeDefined();
    expect(permPositionIndex?.unique).toBe(true);
  });

  it('initialize() is idempotent — calling it again does not duplicate or overwrite data', async () => {
    // Allocate a permission to simulate live data
    await permissionCollection.updateOne(
      { gibbonPermissionPosition: 1 },
      { $set: { gibbonIsAllocated: true, name: 'Existing' } }
    );

    // Call initialize again — should not throw or duplicate
    await mongoDbSeeder.initialize();

    // Counts should remain the same
    const groupCount = await groupCollection.countDocuments();
    const permCount = await permissionCollection.countDocuments();
    expect(groupCount).toBe(config.groupByteLength * 8);
    expect(permCount).toBe(config.permissionByteLength * 8);

    // Existing allocated data should be untouched
    const perm = await permissionCollection.findOne({
      gibbonPermissionPosition: 1,
    });
    expect(perm?.gibbonIsAllocated).toBe(true);
    expect((perm as unknown as { name: string }).name).toBe('Existing');

    // Restore
    await permissionCollection.updateOne(
      { gibbonPermissionPosition: 1 },
      { $set: { gibbonIsAllocated: false }, $unset: { name: '' } }
    );
  });

  it('populateGroupsAndPermissions() throws when data already exists (deprecated)', async () => {
    await expect(mongoDbSeeder.populateGroupsAndPermissions()).rejects.toThrow(
      'Called populateGroupsAndPermissions, but permissions and groups seem to be populated already'
    );
  });
});
