import {
  beforeAll,
  describe,
  expect,
  it,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { Gibbon } from '@icazemier/gibbons';
import { Binary, Collection, MongoClient } from 'mongodb';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';
import { GibbonsMongoDb } from './gibbons-mongo-db.js';
import { MongoDbSeeder } from './seeder.js';
import { Config } from './interfaces/index.js';
import {
  TestUser,
  TestPermission,
  TestGroup,
} from '../test/interfaces/test-interfaces.js';
import { withTransaction } from './utils.js';

/**
 * Creates a fresh config with small byte lengths for faster tests.
 */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    dbName: 'gibbons_resize_test',
    permissionByteLength: 2, // 16 permissions
    groupByteLength: 2, // 16 groups
    mongoDbMutationConcurrency: 10,
    dbStructure: {
      user: { collectionName: 'users' },
      group: { collectionName: 'groups' },
      permission: { collectionName: 'permissions' },
    },
    ...overrides,
  };
}

describe('Resize: expand and shrink', () => {
  let mongoClient: MongoClient;
  let config: Config;
  let adapter: GibbonsMongoDb;
  let dbGroups: Collection<TestGroup>;
  let dbPermissions: Collection<TestPermission>;
  let dbUsers: Collection<TestUser>;

  beforeAll(async () => {
    mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
  });

  afterAll(async () => {
    await mongoClient.close();
  });

  beforeEach(async () => {
    config = makeConfig();
    const db = mongoClient.db(config.dbName);

    // Drop collections for a clean slate
    await db.dropDatabase();

    dbGroups = db.collection<TestGroup>(
      config.dbStructure.group.collectionName
    );
    dbPermissions = db.collection<TestPermission>(
      config.dbStructure.permission.collectionName
    );
    dbUsers = db.collection<TestUser>(config.dbStructure.user.collectionName);

    // Seed initial slots
    const seeder = new MongoDbSeeder(mongoClient, config);
    await seeder.initialize();

    // Create adapter using injected client
    adapter = new GibbonsMongoDb(mongoClient, config);
    await adapter.initialize();
  });

  afterEach(async () => {
    await mongoClient.db(config.dbName).dropDatabase();
  });

  // ---------- expandPermissions ----------

  it('expandPermissions — seeds new slots and pads Binary fields', async () => {
    // Allocate a permission and a group, subscribe it, create a user
    const perm = await adapter.allocatePermission({
      name: 'perm1',
    } as TestPermission);
    const group = await adapter.allocateGroup({ name: 'group1' } as TestGroup);
    await adapter.subscribePermissionsToGroups(
      [group.gibbonGroupPosition],
      [perm.gibbonPermissionPosition]
    );
    const user = await adapter.createUser({
      name: 'Alice',
      email: 'alice@test.com',
    } as TestUser);
    await adapter.subscribeUsersToGroups({ _id: user._id }, [
      group.gibbonGroupPosition,
    ]);

    const oldPermCount = await dbPermissions.countDocuments();
    expect(oldPermCount).toBe(16); // 2 * 8

    // Expand from 2 bytes to 4 bytes (16 → 32 permissions)
    await adapter.expandPermissions(4);

    // New permission slots should exist
    const newPermCount = await dbPermissions.countDocuments();
    expect(newPermCount).toBe(32); // 4 * 8

    // Existing permission data should be untouched
    const permAfter = await dbPermissions.findOne({
      gibbonPermissionPosition: perm.gibbonPermissionPosition,
    });
    expect(permAfter?.gibbonIsAllocated).toBe(true);
    expect(permAfter?.name).toBe('perm1');

    // Group's permissionsGibbon should be padded to 4 bytes
    const groupAfter = await dbGroups.findOne({
      gibbonGroupPosition: group.gibbonGroupPosition,
    });
    expect(groupAfter).toBeDefined();
    const groupPermBuffer = Buffer.from(
      ((groupAfter as TestGroup).permissionsGibbon as Binary).buffer
    );
    expect(groupPermBuffer.length).toBe(4);
    // Original bit should still be set
    const groupGibbon = Gibbon.decode(groupPermBuffer);
    expect(
      groupGibbon.hasAllFromPositions([perm.gibbonPermissionPosition])
    ).toBe(true);

    // User's permissionsGibbon should be padded to 4 bytes
    const userAfter = await dbUsers.findOne({ _id: user._id });
    expect(userAfter).toBeDefined();
    const userPermBuffer = Buffer.from(
      ((userAfter as TestUser).permissionsGibbon as Binary).buffer
    );
    expect(userPermBuffer.length).toBe(4);
    const userPermGibbon = Gibbon.decode(userPermBuffer);
    expect(
      userPermGibbon.hasAllFromPositions([perm.gibbonPermissionPosition])
    ).toBe(true);

    // Config should be updated
    expect(config.permissionByteLength).toBe(4);

    // Can allocate a permission in the expanded range
    const newPerm = await adapter.allocatePermission({
      name: 'newPerm',
    } as TestPermission);
    expect(newPerm.gibbonPermissionPosition).toBeGreaterThan(0);
  });

  it('expandPermissions — throws when newByteLength <= current', async () => {
    await expect(adapter.expandPermissions(2)).rejects.toThrow(
      'must be greater than'
    );
    await expect(adapter.expandPermissions(1)).rejects.toThrow(
      'must be greater than'
    );
  });

  // ---------- expandGroups ----------

  it('expandGroups — seeds new group slots and pads user groupsGibbon', async () => {
    const group = await adapter.allocateGroup({ name: 'group1' } as TestGroup);
    const user = await adapter.createUser({
      name: 'Bob',
      email: 'bob@test.com',
    } as TestUser);
    await adapter.subscribeUsersToGroups({ _id: user._id }, [
      group.gibbonGroupPosition,
    ]);

    const oldGroupCount = await dbGroups.countDocuments();
    expect(oldGroupCount).toBe(16);

    // Expand from 2 bytes to 4 bytes (16 → 32 groups)
    await adapter.expandGroups(4);

    const newGroupCount = await dbGroups.countDocuments();
    expect(newGroupCount).toBe(32);

    // User's groupsGibbon should be padded to 4 bytes with original bit preserved
    const userAfter = await dbUsers.findOne({ _id: user._id });
    expect(userAfter).toBeDefined();
    const userGroupBuffer = Buffer.from(
      ((userAfter as TestUser).groupsGibbon as Binary).buffer
    );
    expect(userGroupBuffer.length).toBe(4);
    const userGroupGibbon = Gibbon.decode(userGroupBuffer);
    expect(
      userGroupGibbon.hasAllFromPositions([group.gibbonGroupPosition])
    ).toBe(true);

    expect(config.groupByteLength).toBe(4);
  });

  it('expandGroups — throws when newByteLength <= current', async () => {
    await expect(adapter.expandGroups(2)).rejects.toThrow(
      'must be greater than'
    );
  });

  // ---------- shrinkPermissions ----------

  it('shrinkPermissions — removes trailing slots and truncates Binaries', async () => {
    // Allocate resources at the original byte length BEFORE expanding
    const perm = await adapter.allocatePermission({
      name: 'lowPerm',
    } as TestPermission);
    expect(perm.gibbonPermissionPosition).toBeLessThanOrEqual(16);

    const group = await adapter.allocateGroup({ name: 'g1' } as TestGroup);
    await adapter.subscribePermissionsToGroups(
      [group.gibbonGroupPosition],
      [perm.gibbonPermissionPosition]
    );
    const user = await adapter.createUser({
      name: 'Carol',
      email: 'carol@test.com',
    } as TestUser);
    await adapter.subscribeUsersToGroups({ _id: user._id }, [
      group.gibbonGroupPosition,
    ]);

    // Expand to 4 bytes, then shrink back to 2
    await adapter.expandPermissions(4);
    await adapter.shrinkPermissions(2);

    // Trailing slots should be removed
    const permCount = await dbPermissions.countDocuments();
    expect(permCount).toBe(16);

    // Group's permissionsGibbon should be 2 bytes, original bit preserved
    const groupAfter = await dbGroups.findOne({
      gibbonGroupPosition: group.gibbonGroupPosition,
    });
    expect(groupAfter).toBeDefined();
    const gpBuf = Buffer.from(
      ((groupAfter as TestGroup).permissionsGibbon as Binary).buffer
    );
    expect(gpBuf.length).toBe(2);
    expect(
      Gibbon.decode(gpBuf).hasAllFromPositions([perm.gibbonPermissionPosition])
    ).toBe(true);

    // User's permissionsGibbon should be 2 bytes
    const userAfter = await dbUsers.findOne({ _id: user._id });
    expect(userAfter).toBeDefined();
    const upBuf = Buffer.from(
      ((userAfter as TestUser).permissionsGibbon as Binary).buffer
    );
    expect(upBuf.length).toBe(2);
    expect(
      Gibbon.decode(upBuf).hasAllFromPositions([perm.gibbonPermissionPosition])
    ).toBe(true);

    expect(config.permissionByteLength).toBe(2);
  });

  it('shrinkPermissions — throws when allocated permissions exist beyond boundary', async () => {
    // Allocate all 16 permission slots so position 16 is in-use
    // Then try to shrink to 1 byte (8 slots) — position 16 > 8
    for (let i = 0; i < 16; i++) {
      await adapter.allocatePermission({ name: `p${i}` } as TestPermission);
    }

    await expect(adapter.shrinkPermissions(1)).rejects.toThrow(
      'Cannot shrink: allocated permissions exist beyond the new boundary'
    );
  });

  it('shrinkPermissions — throws when newByteLength >= current', async () => {
    await expect(adapter.shrinkPermissions(2)).rejects.toThrow(
      'must be less than'
    );
    await expect(adapter.shrinkPermissions(3)).rejects.toThrow(
      'must be less than'
    );
  });

  // ---------- shrinkGroups ----------

  it('shrinkGroups — removes trailing slots and truncates user groupsGibbon', async () => {
    // Allocate resources at the original byte length BEFORE expanding
    const group = await adapter.allocateGroup({ name: 'g1' } as TestGroup);
    expect(group.gibbonGroupPosition).toBeLessThanOrEqual(16);

    const user = await adapter.createUser({
      name: 'Dave',
      email: 'dave@test.com',
    } as TestUser);
    await adapter.subscribeUsersToGroups({ _id: user._id }, [
      group.gibbonGroupPosition,
    ]);

    // Expand then shrink back
    await adapter.expandGroups(4);
    await adapter.shrinkGroups(2);

    const groupCount = await dbGroups.countDocuments();
    expect(groupCount).toBe(16);

    // User's groupsGibbon should be 2 bytes, original bit preserved
    const userAfter = await dbUsers.findOne({ _id: user._id });
    expect(userAfter).toBeDefined();
    const ugBuf = Buffer.from(
      ((userAfter as TestUser).groupsGibbon as Binary).buffer
    );
    expect(ugBuf.length).toBe(2);
    expect(
      Gibbon.decode(ugBuf).hasAllFromPositions([group.gibbonGroupPosition])
    ).toBe(true);

    expect(config.groupByteLength).toBe(2);
  });

  it('shrinkGroups — throws when allocated groups exist beyond boundary', async () => {
    // Allocate all 16 group slots
    for (let i = 0; i < 16; i++) {
      await adapter.allocateGroup({ name: `g${i}` } as TestGroup);
    }

    await expect(adapter.shrinkGroups(1)).rejects.toThrow(
      'Cannot shrink: allocated groups exist beyond the new boundary'
    );
  });

  it('shrinkGroups — throws when newByteLength >= current', async () => {
    await expect(adapter.shrinkGroups(2)).rejects.toThrow('must be less than');
  });

  // ---------- External transaction session ----------

  it('expand + shrink within an external transaction session', async () => {
    const perm = await adapter.allocatePermission({
      name: 'txPerm',
    } as TestPermission);
    const group = await adapter.allocateGroup({ name: 'txGroup' } as TestGroup);
    await adapter.subscribePermissionsToGroups(
      [group.gibbonGroupPosition],
      [perm.gibbonPermissionPosition]
    );
    const user = await adapter.createUser({
      name: 'Eve',
      email: 'eve@test.com',
    } as TestUser);
    await adapter.subscribeUsersToGroups({ _id: user._id }, [
      group.gibbonGroupPosition,
    ]);

    // Expand inside a transaction
    await withTransaction(mongoClient, async (session) => {
      await adapter.expandPermissions(4, session);
      await adapter.expandGroups(4, session);
    });

    expect(config.permissionByteLength).toBe(4);
    expect(config.groupByteLength).toBe(4);

    const permCount = await dbPermissions.countDocuments();
    expect(permCount).toBe(32);
    const groupCount = await dbGroups.countDocuments();
    expect(groupCount).toBe(32);

    // Verify data integrity
    const userAfter = await dbUsers.findOne({ _id: user._id });
    expect(userAfter).toBeDefined();
    const upBuf = Buffer.from(
      ((userAfter as TestUser).permissionsGibbon as Binary).buffer
    );
    const ugBuf = Buffer.from(
      ((userAfter as TestUser).groupsGibbon as Binary).buffer
    );
    expect(upBuf.length).toBe(4);
    expect(ugBuf.length).toBe(4);
    expect(
      Gibbon.decode(upBuf).hasAllFromPositions([perm.gibbonPermissionPosition])
    ).toBe(true);
    expect(
      Gibbon.decode(ugBuf).hasAllFromPositions([group.gibbonGroupPosition])
    ).toBe(true);

    // Shrink inside a transaction
    await withTransaction(mongoClient, async (session) => {
      await adapter.shrinkPermissions(2, session);
      await adapter.shrinkGroups(2, session);
    });

    expect(config.permissionByteLength).toBe(2);
    expect(config.groupByteLength).toBe(2);

    const permCountAfter = await dbPermissions.countDocuments();
    expect(permCountAfter).toBe(16);
    const groupCountAfter = await dbGroups.countDocuments();
    expect(groupCountAfter).toBe(16);
  });
});
