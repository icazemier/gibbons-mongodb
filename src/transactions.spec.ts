import {
  beforeAll,
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import { Gibbon } from '@icazemier/gibbons';
import { Binary, Collection, MongoClient } from 'mongodb';
import {
  PERMISSION_POSITIONS_FIXTURES,
  GROUP_POSITION_FIXTURES,
} from '../test/helper/fixtures.js';
import {
  TestUser,
  TestPermission,
  TestGroup,
} from '../test/interfaces/test-interfaces.js';
import {
  seedTestFixtures,
  seedUserTestFixtures,
  tearDownGroupTestFixtures,
  tearDownPermissionTestFixtures,
  tearDownUserTestFixtures,
} from '../test/helper/seeders.js';
import { MongoDbTestServer } from '../test/helper/mongodb-memory-server.js';
import { GibbonsMongoDb } from './gibbons-mongo-db.js';
import { MongoDbSeeder } from './seeder.js';
import { ConfigLoader } from './config.js';
import { Config } from './interfaces/index.js';
import { withTransaction } from './utils.js';

const toBuffer = (uint8: Uint8Array): Buffer => Buffer.from(uint8);

describe('External session / transaction support', () => {
  let mongoDbAdapter: GibbonsMongoDb;
  let seedClient: MongoClient;
  let adapterClient: MongoClient;
  let dbCollection: {
    user: Collection<TestUser>;
    group: Collection<TestGroup>;
    permission: Collection<TestPermission>;
  };
  let config: Config;

  beforeAll(async () => {
    // The adapter is constructed with an injected MongoClient
    // so sessions from this client work directly with all facade methods
    seedClient = await new MongoClient(MongoDbTestServer.uri).connect();
    adapterClient = await new MongoClient(MongoDbTestServer.uri).connect();
    config = await ConfigLoader.load('gibbons-mongodb-sample');

    mongoDbAdapter = new GibbonsMongoDb(adapterClient, config);
    await mongoDbAdapter.initialize();

    dbCollection = {
      user: adapterClient
        .db(config.dbName)
        .collection<TestUser>(config.dbStructure.user.collectionName),
      group: adapterClient
        .db(config.dbName)
        .collection<TestGroup>(config.dbStructure.group.collectionName),
      permission: adapterClient
        .db(config.dbName)
        .collection<TestPermission>(
          config.dbStructure.permission.collectionName
        ),
    };

    const mongoDbSeeder = new MongoDbSeeder(seedClient, config);
    await mongoDbSeeder.initialize();
    await seedTestFixtures(seedClient, config);
  });

  beforeEach(async () => {
    await seedUserTestFixtures(seedClient, config);
  });

  afterEach(async () => {
    await tearDownUserTestFixtures(seedClient, config);
  });

  afterAll(async () => {
    await tearDownGroupTestFixtures(seedClient, config);
    await tearDownPermissionTestFixtures(seedClient, config);
    await seedClient.close();
    await adapterClient.close();
  });

  it('getMongoClient returns the injected client', () => {
    expect(mongoDbAdapter.getMongoClient()).toBe(adapterClient);
  });

  it('constructor with URI creates a separate internal client', async () => {
    const uriAdapter = new GibbonsMongoDb(MongoDbTestServer.uri, config);
    await uriAdapter.initialize();
    const internalClient = uriAdapter.getMongoClient();

    expect(internalClient).not.toBe(adapterClient);
    expect(internalClient).toBeInstanceOf(MongoClient);
    await internalClient.close();
  });

  it('allocatePermission with external session commits atomically', async () => {
    const permission = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.allocatePermission<TestPermission>(
        { name: 'Tx Permission' } as TestPermission,
        session
      );
    });

    expect(permission.gibbonIsAllocated).toBe(true);
    expect((permission as unknown as TestPermission).name).toBe(
      'Tx Permission'
    );

    // Verify it persisted after the transaction committed
    const doc = await dbCollection.permission.findOne({
      gibbonPermissionPosition: permission.gibbonPermissionPosition,
    });
    expect(doc).not.toBeNull();
    expect(doc?.gibbonIsAllocated).toBe(true);
  });

  it('allocateGroup with external session commits atomically', async () => {
    const group = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.allocateGroup<TestGroup>(
        { name: 'Tx Group' } as TestGroup,
        session
      );
    });

    expect(group.gibbonIsAllocated).toBe(true);
    expect((group as unknown as TestGroup).name).toBe('Tx Group');
  });

  it('createUser with external session commits atomically', async () => {
    const user = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.createUser(
        { name: 'Tx User', email: 'tx@user.com' },
        session
      );
    });

    expect((user as unknown as TestUser).name).toBe('Tx User');
    expect(user.groupsGibbon).toBeInstanceOf(Gibbon);
    expect(user.permissionsGibbon).toBeInstanceOf(Gibbon);

    const doc = await dbCollection.user.findOne({ email: 'tx@user.com' });
    expect(doc).not.toBeNull();
  });

  it('multiple operations in a single external transaction commit together', async () => {
    await withTransaction(adapterClient, async (session) => {
      // Create a user and subscribe to a group, all in one external transaction
      await mongoDbAdapter.createUser(
        { name: 'Multi-Op User', email: 'multi@op.com' },
        session
      );
      await mongoDbAdapter.subscribeUsersToGroups(
        { email: 'multi@op.com' },
        [GROUP_POSITION_FIXTURES.GI_JOE],
        session
      );
    });

    const user = (await dbCollection.user.findOne({
      email: 'multi@op.com',
    })) as TestUser;

    expect(user).not.toBeNull();
    const groupPositions = Gibbon.decode(
      toBuffer((user.groupsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(groupPositions).toContain(GROUP_POSITION_FIXTURES.GI_JOE);

    // User should have inherited GI_JOE's permissions (GOD_MODE)
    const permissionPositions = Gibbon.decode(
      toBuffer((user.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(permissionPositions).toContain(
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE
    );
  });

  it('external transaction rollback leaves no changes', async () => {
    const userCountBefore = await dbCollection.user.countDocuments();

    try {
      await withTransaction(adapterClient, async (session) => {
        await mongoDbAdapter.createUser(
          { name: 'Rollback User', email: 'rollback@test.com' },
          session
        );

        // Verify the user IS visible within the session
        const withinTx = await dbCollection.user.findOne(
          { email: 'rollback@test.com' },
          { session }
        );
        expect(withinTx).not.toBeNull();

        // Force abort by throwing
        throw new Error('Intentional abort');
      });
    } catch (error) {
      expect((error as Error).message).toBe('Intentional abort');
    }

    // User should NOT exist after rollback
    const userCountAfter = await dbCollection.user.countDocuments();
    expect(userCountAfter).toBe(userCountBefore);

    const doc = await dbCollection.user.findOne({
      email: 'rollback@test.com',
    });
    expect(doc).toBeNull();
  });

  it('subscribePermissionsToGroups with external session', async () => {
    await withTransaction(adapterClient, async (session) => {
      await mongoDbAdapter.subscribePermissionsToGroups(
        [GROUP_POSITION_FIXTURES.A_TEAM],
        [PERMISSION_POSITIONS_FIXTURES.ADMIN],
        session
      );
    });

    // A_TEAM should now also have ADMIN permission
    const group = (await dbCollection.group.findOne({
      gibbonGroupPosition: GROUP_POSITION_FIXTURES.A_TEAM,
    })) as TestGroup;

    const groupPerms = Gibbon.decode(
      toBuffer((group.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(groupPerms).toContain(PERMISSION_POSITIONS_FIXTURES.ADMIN);
    expect(groupPerms).toContain(PERMISSION_POSITIONS_FIXTURES.USER);
    expect(groupPerms).toContain(PERMISSION_POSITIONS_FIXTURES.BACK_DOOR);
  });

  it('unsubscribeUsersFromGroups with external session', async () => {
    // First subscribe Cooper to TRANSFORMERS
    await mongoDbAdapter.subscribeUsersToGroups({ name: /Cooper/ }, [
      GROUP_POSITION_FIXTURES.TRANSFORMERS,
    ]);

    // Now unsubscribe within an external transaction
    await withTransaction(adapterClient, async (session) => {
      await mongoDbAdapter.unsubscribeUsersFromGroups(
        { name: /Cooper/ },
        [GROUP_POSITION_FIXTURES.TRANSFORMERS],
        session
      );
    });

    const user = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const groupsAfter = Gibbon.decode(
      toBuffer((user.groupsGibbon as Binary).buffer)
    ).getPositionsArray();

    expect(groupsAfter).not.toContain(GROUP_POSITION_FIXTURES.TRANSFORMERS);
    expect(groupsAfter).toContain(GROUP_POSITION_FIXTURES.PLANETEERS);
  });

  it('unsubscribePermissionsFromGroups with external session', async () => {
    await withTransaction(adapterClient, async (session) => {
      await mongoDbAdapter.unsubscribePermissionsFromGroups(
        [GROUP_POSITION_FIXTURES.PLANETEERS],
        [PERMISSION_POSITIONS_FIXTURES.THE_EDGE],
        session
      );
    });

    const group = (await dbCollection.group.findOne({
      gibbonGroupPosition: GROUP_POSITION_FIXTURES.PLANETEERS,
    })) as TestGroup;
    const groupPerms = Gibbon.decode(
      toBuffer((group.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(groupPerms).not.toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);
    expect(groupPerms).toContain(PERMISSION_POSITIONS_FIXTURES.USER);

    // Cooper (member of PLANETEERS) should no longer have THE_EDGE
    const user = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const userPerms = Gibbon.decode(
      toBuffer((user.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(userPerms).not.toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);
  });

  it('removeUser with external session', async () => {
    await mongoDbAdapter.createUser({
      name: 'To Remove',
      email: 'remove-tx@test.com',
    });

    const removed = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.removeUser(
        { email: 'remove-tx@test.com' },
        session
      );
    });

    expect(removed).toBe(1);
    const doc = await dbCollection.user.findOne({
      email: 'remove-tx@test.com',
    });
    expect(doc).toBeNull();
  });

  it('updateGroupMetadata with external session', async () => {
    const updated = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.updateGroupMetadata(
        GROUP_POSITION_FIXTURES.GI_JOE,
        { name: 'GI Joe Tx' },
        session
      );
    });

    expect(updated).not.toBeNull();
    expect((updated as unknown as TestGroup).name).toBe('GI Joe Tx');

    // Restore
    await mongoDbAdapter.updateGroupMetadata(GROUP_POSITION_FIXTURES.GI_JOE, {
      name: 'GI Joe',
    });
  });

  it('updatePermissionMetadata with external session', async () => {
    const updated = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.updatePermissionMetadata(
        PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
        { name: 'God Mode Tx' },
        session
      );
    });

    expect(updated).not.toBeNull();
    expect((updated as unknown as TestPermission).name).toBe('God Mode Tx');

    // Restore
    await mongoDbAdapter.updatePermissionMetadata(
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      { name: 'God mode' }
    );
  });

  it('updateUserMetadata with external session', async () => {
    const updated = await withTransaction(adapterClient, async (session) => {
      return mongoDbAdapter.updateUserMetadata(
        { name: 'Cooper' },
        { email: 'cooper-tx@test.com' },
        session
      );
    });

    expect(updated).not.toBeNull();
    expect((updated as unknown as TestUser).email).toBe('cooper-tx@test.com');
  });

  it('deallocatePermissions with external session', async () => {
    // Allocate a fresh permission to deallocate
    const perm = await mongoDbAdapter.allocatePermission<TestPermission>({
      name: 'To Deallocate',
    } as TestPermission);
    const pos = perm.gibbonPermissionPosition;

    await withTransaction(adapterClient, async (session) => {
      await mongoDbAdapter.deallocatePermissions([pos], session);
    });

    const doc = await dbCollection.permission.findOne({
      gibbonPermissionPosition: pos,
    });
    expect(doc).not.toBeNull();
    expect(doc?.gibbonIsAllocated).toBe(false);
  });

  it('deallocateGroups with external session', async () => {
    const group = await mongoDbAdapter.allocateGroup<TestGroup>({
      name: 'To Deallocate',
    } as TestGroup);
    const pos = group.gibbonGroupPosition;

    await withTransaction(adapterClient, async (session) => {
      await mongoDbAdapter.deallocateGroups([pos], session);
    });

    const doc = await dbCollection.group.findOne({
      gibbonGroupPosition: pos,
    });
    expect(doc).not.toBeNull();
    expect(doc?.gibbonIsAllocated).toBe(false);
  });
});
