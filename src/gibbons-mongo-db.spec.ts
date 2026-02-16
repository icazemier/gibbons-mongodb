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
import { Binary, Collection, Filter, MongoClient, ObjectId } from 'mongodb';
import { writableNoopStream } from 'noop-stream';
import { pipeline, PassThrough } from 'node:stream';
import {
  usersFixtures,
  groupsFixtures,
  permissionsFixtures,
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

// Helper to convert Binary.buffer (Uint8Array) to Buffer for type compatibility
const toBuffer = (uint8: Uint8Array): Buffer => Buffer.from(uint8);

describe('Happy flows', () => {
  let mongoDbAdapter: GibbonsMongoDb;
  let mongoClient: MongoClient;
  let dbCollection: {
    user: Collection<TestUser>;
    group: Collection<TestGroup>;
    permission: Collection<TestPermission>;
  };
  let config: Config;

  beforeAll(async () => {
    mongoClient = await new MongoClient(MongoDbTestServer.uri).connect();
    config = await ConfigLoader.load('gibbons-mongodb-sample');

    dbCollection = {
      user: mongoClient
        .db(config.dbName)
        .collection<TestUser>(config.dbStructure.user.collectionName),
      group: mongoClient
        .db(config.dbName)
        .collection<TestGroup>(config.dbStructure.group.collectionName),
      permission: mongoClient
        .db(config.dbName)
        .collection<TestPermission>(
          config.dbStructure.permission.collectionName
        ),
    };

    mongoDbAdapter = new GibbonsMongoDb(MongoDbTestServer.uri, config);
    await mongoDbAdapter.initialize();

    const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
    await mongoDbSeeder.initialize();
    // Test fixtures
    await seedTestFixtures(mongoClient, config);
  });

  beforeEach(async () => {
    await seedUserTestFixtures(mongoClient, config);
  });

  afterEach(async () => {
    await tearDownUserTestFixtures(mongoClient, config);
  });

  afterAll(async () => {
    await tearDownGroupTestFixtures(mongoClient, config);
    await tearDownPermissionTestFixtures(mongoClient, config);
    await mongoClient.close();
  });

  it('Find users by a group name with positions', async () => {
    const filter = {
      name: groupsFixtures[0].name,
      gibbonIsAllocated: true,
    };
    const groupPositions = await dbCollection.group
      .find(filter, {
        projection: {
          _id: 0,
          gibbonGroupPosition: 1,
        },
      })
      .map((group) => group.gibbonGroupPosition)
      .toArray();

    const testUserfilter = {
      groupsGibbon: {
        $bitsAnySet: new Binary(
          Gibbon.create(1024).setAllFromPositions(groupPositions).toBuffer()
        ),
      },
    } as Filter<TestUser>;

    const testUser = await dbCollection.user.findOne(testUserfilter);
    console.log(`Test user: ${testUser?.email}`);

    const users = (await mongoDbAdapter
      .findUsersByGroups(groupPositions)
      .toArray()) as TestUser[];

    expect(users).toBeInstanceOf(Array);
    expect(users).toHaveLength(1);
    const [user] = users;

    expect(ObjectId.isValid(user._id)).toBe(true);
    expect(user.name).toBe(usersFixtures[2].name);
    expect(user.email).toBe(usersFixtures[2].email);
    expect(
      Buffer.compare(
        (user.groupsGibbon as Gibbon).toBuffer(),
        usersFixtures[2].groupsGibbon
      )
    ).toBe(0);
  });

  it('Find users by a group name with Gibbon', async () => {
    const groupsGibbon = Gibbon.create(2).setAllFromPositions([
      groupsFixtures[0].gibbonGroupPosition,
    ]);
    const users = (await mongoDbAdapter
      .findUsersByGroups(groupsGibbon)
      .toArray()) as TestUser[];

    expect(users).toBeInstanceOf(Array);
    expect(users).toHaveLength(1);
    const [user] = users;
    expect(ObjectId.isValid(user._id)).toBe(true);
    expect(user.name).toBe(usersFixtures[2].name);
    expect(user.email).toBe(usersFixtures[2].email);
    expect(
      Buffer.compare(
        (user.groupsGibbon as Gibbon).toBuffer(),
        usersFixtures[2].groupsGibbon
      )
    ).toBe(0);
  });

  it('Find users by permission name with positions', async () => {
    const filter = {
      name: permissionsFixtures[0].name,
      gibbonIsAllocated: true,
    };
    const permissionPositions = await dbCollection.permission
      .find(filter, {
        projection: {
          _id: 0,
          gibbonPermissionPosition: 1,
        },
      })
      .map((permission) => permission.gibbonPermissionPosition)
      .toArray();

    const users = (await mongoDbAdapter
      .findUsersByPermissions(permissionPositions)
      .toArray()) as TestUser[];

    expect(users).toBeInstanceOf(Array);
    expect(users).toHaveLength(1);
    const [user] = users;
    expect(ObjectId.isValid(user._id)).toBe(true);
    expect(user.name).toBe(usersFixtures[2].name);
    expect(user.email).toBe(usersFixtures[2].email);
    expect(
      Buffer.compare(
        (user.groupsGibbon as Gibbon).toBuffer(),
        usersFixtures[2].groupsGibbon
      )
    ).toBe(0);
  });

  it('Find users by group positions using Node.js streams', async () => {
    const filter = {
      name: groupsFixtures[2].name,
      gibbonIsAllocated: true,
    };
    const groupPositions = await dbCollection.group
      .find(filter, {
        projection: {
          _id: 0,
          gibbonGroupPosition: 1,
        },
      })
      .map((group) => group.gibbonGroupPosition)
      .toArray();

    const readableStream = mongoDbAdapter
      .findUsersByGroups(groupPositions)
      .stream();

    let assertions = 0;

    const streamTestWrapper = () =>
      new Promise<void>((resolve, reject) => {
        const testStream = new PassThrough({ objectMode: true });

        testStream.on('data', (user) => {
          assertions++;
          expect(
            ['info@arnieslife.com', 'captain@planet.nl'].includes(user.email)
          ).toBe(true);
        });

        pipeline(
          readableStream,
          testStream,
          writableNoopStream({ objectMode: true }),
          (error) => {
            if (error) {
              return reject(error);
            }
            return resolve();
          }
        );
      });

    await streamTestWrapper();
    expect(assertions).toBe(2);
  });

  it('Find users by groups gibbon using Node.js streams', async () => {
    const groupsGibbon = Gibbon.create(128).setAllFromPositions([
      groupsFixtures[2].gibbonGroupPosition,
    ]);
    const readableStream = mongoDbAdapter
      .findUsersByGroups(groupsGibbon)
      .stream();

    let assertions = 0;

    const streamTestWrapper = () =>
      new Promise<void>((resolve, reject) => {
        const testStream = new PassThrough({ objectMode: true });

        testStream.on('data', (user) => {
          assertions++;
          expect(
            ['info@arnieslife.com', 'captain@planet.nl'].includes(user.email)
          ).toBe(true);
        });

        pipeline(
          readableStream,
          testStream,
          writableNoopStream({ objectMode: true }),
          (error) => {
            if (error) {
              return reject(error);
            }
            return resolve();
          }
        );
      });

    await streamTestWrapper();
    expect(assertions).toBe(2);
  });

  it('Find groups by permissions', async () => {
    const filter = {
      name: permissionsFixtures[0].name,
      gibbonIsAllocated: true,
    };
    const permissionPositions = await dbCollection.permission
      .find(filter, {
        projection: {
          _id: 0,
          gibbonPermissionPosition: 1,
        },
      })
      .map((permission) => permission.gibbonPermissionPosition)
      .toArray();

    const groups = (await mongoDbAdapter
      .findGroupsByPermissions(permissionPositions)
      .toArray()) as TestGroup[];
    expect(groups).toBeInstanceOf(Array);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(ObjectId.isValid(group._id)).toBe(true);
    expect(group.name).toBe(groupsFixtures[0].name);
    expect(
      Buffer.compare(
        (group.permissionsGibbon as Gibbon).toBuffer(),
        groupsFixtures[0].permissionsGibbon
      )
    ).toBe(0);
    expect(group.gibbonGroupPosition).toBe(
      groupsFixtures[0].gibbonGroupPosition
    );
    expect(group.gibbonIsAllocated).toBe(groupsFixtures[0].gibbonIsAllocated);
  });

  it('Allocate a permission, check before and after', async () => {
    const expectedToAllocateToPosition =
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE + 1;

    const nonAllocatedPermission = (await dbCollection.permission.findOne({
      gibbonPermissionPosition: expectedToAllocateToPosition,
    })) as TestPermission;

    expect(nonAllocatedPermission.gibbonPermissionPosition).toBe(
      expectedToAllocateToPosition
    );
    expect(Boolean(nonAllocatedPermission.name)).toBe(false);
    expect(nonAllocatedPermission.gibbonIsAllocated).toBe(false);

    const permissionToCreate = {
      name: 'Able to create a shopping basket',
    } as TestPermission;
    const permission = (await mongoDbAdapter.allocatePermission<TestPermission>(
      permissionToCreate
    )) as TestPermission;

    expect(permission.name).toBe(permissionToCreate.name);
    expect(permission.gibbonIsAllocated).toBe(true);
    expect(permission.gibbonPermissionPosition).toBe(
      expectedToAllocateToPosition
    );
  });

  it('Allocate some permissions on groups, then deallocate them and check groups for permissions', async () => {
    const { gibbonPermissionPosition: position1 } =
      await mongoDbAdapter.allocatePermission({
        name: 'permission 1',
      } as TestPermission);
    const { gibbonPermissionPosition: position2 } =
      await mongoDbAdapter.allocatePermission({
        name: 'permission 2',
      } as TestPermission);
    const { gibbonPermissionPosition: position3 } =
      await mongoDbAdapter.allocatePermission({
        name: 'permission 3',
      } as TestPermission);
    const permissionPositions = [position1, position2, position3];

    const groupBefore = (await dbCollection.group.findOne({
      name: 'GI Joe',
    })) as TestGroup;

    const {
      permissionsGibbon,
      gibbonGroupPosition: gibbonGroupPositionBefore,
    } = groupBefore;

    const { buffer: bufferBefore } = permissionsGibbon as Binary;

    const gibbonPermissionsBefore = Gibbon.decode(toBuffer(bufferBefore))
      .setAllFromPositions(permissionPositions)
      .toBuffer();

    await dbCollection.group.findOneAndUpdate(
      {
        gibbonGroupPosition: gibbonGroupPositionBefore,
      },
      {
        $set: { permissionsGibbon: gibbonPermissionsBefore },
      }
    );

    const usersBefore = [
      {
        email: 'test1@test.com',
        name: 'Test 1',
        groupsGibbon: Gibbon.create(1024)
          .setPosition(GROUP_POSITION_FIXTURES.GI_JOE)
          .toBuffer(),
        permissionsGibbon: gibbonPermissionsBefore,
      },
      {
        email: 'test2@test.com',
        name: 'Test 2',
        groupsGibbon: Gibbon.create(1024)
          .setPosition(GROUP_POSITION_FIXTURES.GI_JOE)
          .toBuffer(),
        permissionsGibbon: gibbonPermissionsBefore,
      },
    ] as TestUser[];
    await dbCollection.user.insertMany(usersBefore);

    await mongoDbAdapter.deallocatePermissions(permissionPositions);

    const permissions = await dbCollection.permission
      .find({ gibbonPermissionPosition: { $in: permissionPositions } })
      .toArray();

    expect(permissions.length).toBe(permissionPositions.length);
    permissions.forEach((permission) => {
      expect(
        permissionPositions.includes(permission.gibbonPermissionPosition)
      ).toBe(true);
      expect(ObjectId.isValid(permission._id)).toBe(true);
      expect(typeof permission.gibbonPermissionPosition).toBe('number');
      expect(permission.gibbonIsAllocated).toBe(false);
      expect(Boolean(permission.name)).toBe(false);
    });

    const [groupAfter] = await dbCollection.group
      .find({ name: 'GI Joe' })
      .toArray();
    const { permissionsGibbon: permissionsAfter } = groupAfter;
    const { buffer: bufferAfter } = permissionsAfter as Binary;
    const gibbonAfter = Gibbon.decode(toBuffer(bufferAfter));

    const positionsAfter = gibbonAfter.getPositionsArray();
    expect(positionsAfter).toBeInstanceOf(Array);
    expect(positionsAfter).toHaveLength(1);
    expect(positionsAfter).toContain(GROUP_POSITION_FIXTURES.GI_JOE);

    const hasAnyAfter = gibbonAfter.hasAnyFromPositions(permissionPositions);
    expect(hasAnyAfter).toBe(false);

    const usersAfter = await dbCollection.user
      .find({ email: /test.com/ })
      .toArray();

    usersAfter.forEach((user) => {
      const { buffer: permissionBuffer } = user.permissionsGibbon as Binary;
      const { buffer: groupBuffer } = user.groupsGibbon as Binary;
      const permissionPositionsGibbon = Gibbon.decode(
        toBuffer(permissionBuffer)
      );
      expect(
        permissionPositionsGibbon.hasAnyFromPositions(permissionPositions)
      ).toBe(false);

      const groupPositionsGibbon = Gibbon.decode(toBuffer(groupBuffer));
      expect(
        groupPositionsGibbon.hasAnyFromPositions([
          GROUP_POSITION_FIXTURES.GI_JOE,
        ])
      ).toBe(true);
    });
  });

  it('Allocate some groups on user, then deallocate them and check users for groups', async () => {
    const { gibbonGroupPosition: position1 } =
      await mongoDbAdapter.allocateGroup({
        name: 'My allocated test group 1 (should be position 3)',
      } as TestGroup);
    const { gibbonGroupPosition: position2 } =
      await mongoDbAdapter.allocateGroup({
        name: 'My allocated test group 2 (should be position 4)',
      } as TestGroup);

    expect(position1).toBe(3);
    expect(position2).toBe(4);

    const userBefore = await dbCollection.user.findOne({
      email: 'captain@planet.nl',
    });

    const { groupsGibbon: groupsBefore, _id } = userBefore as TestUser;
    const { buffer: groupsBufferBefore } = groupsBefore as Binary;
    const groupsGibbonBefore = Gibbon.decode(toBuffer(groupsBufferBefore));
    const isMemberOfGroupsBefore = groupsGibbonBefore.hasAnyFromPositions([
      position1,
      position2,
    ]);

    expect(isMemberOfGroupsBefore).toBe(false);

    groupsGibbonBefore.setAllFromPositions([position1, position2]);
    await dbCollection.user.updateOne(
      { _id },
      { $set: { groupsGibbon: groupsGibbonBefore.toBuffer() } }
    );

    await mongoDbAdapter.deallocateGroups([position1, position2]);

    const userAfter = await dbCollection.user.findOne({
      _id,
    });
    const { groupsGibbon } = userAfter as TestUser;

    const { buffer: groupsBufferAfter } = groupsGibbon as Binary;

    const hasGroupsAfter = Gibbon.decode(
      toBuffer(groupsBufferAfter)
    ).hasAnyFromPositions([position1, position2]);
    expect(hasGroupsAfter).toBe(false);
  });

  it('Find Groups By User', async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });

    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;

    const gibbon = Gibbon.decode(toBuffer(buffer));
    const groupsFromDB = (await mongoDbAdapter
      .findGroups(gibbon)
      .toArray()) as TestGroup[];
    expect(groupsFromDB).toBeInstanceOf(Array);
    expect(groupsFromDB).toHaveLength(1);

    const [groupFromDB] = groupsFromDB;
    const { _id, permissionsGibbon, ...group } = groupFromDB;
    const groupFromFixture = groupsFixtures[2];

    const gibbonFromFixtures = Gibbon.fromBuffer(
      groupFromFixture.permissionsGibbon
    );

    expect(ObjectId.isValid(_id)).toBe(true);
    expect(gibbonFromFixtures.equals(permissionsGibbon as Gibbon)).toBe(true);
    expect(group.gibbonGroupPosition).toBe(
      groupFromFixture.gibbonGroupPosition
    );
    expect(group.gibbonIsAllocated).toBe(true);
  });

  it('Validate a user on all mandatory permissions', async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });
    expect(user).toBeDefined();
    if (!user) return;
    const { buffer } = user.permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
      toBuffer(buffer),
      [
        PERMISSION_POSITIONS_FIXTURES.USER,
        PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
      ]
    );
    expect(valid).toBe(true);
  });

  it(`Validate a user on all mandatory permissions, where Arnold hasn't got them all`, async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });
    expect(user).toBeDefined();
    if (!user) return;
    const { buffer } = user.permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
      toBuffer(buffer),
      [
        PERMISSION_POSITIONS_FIXTURES.USER,
        PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
        PERMISSION_POSITIONS_FIXTURES.ADMIN,
      ]
    );
    expect(valid).toBe(false);
  });

  it(`Validate a user on all mandatory permissions, but user hasn't got any group membership`, async () => {
    const user = await dbCollection.user.findOne({
      email: 'john@doe.born',
    });
    expect(user).toBeDefined();
    if (!user) return;
    const { buffer } = user.permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
      toBuffer(buffer),
      [
        PERMISSION_POSITIONS_FIXTURES.USER,
        PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
      ]
    );
    expect(valid).toBe(false);
  });

  it('Validate a user on any permissions', async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });

    const { permissionsGibbon } = user as TestUser;
    const { buffer } = permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAnyPermissions(
      toBuffer(buffer),
      [PERMISSION_POSITIONS_FIXTURES.USER]
    );
    expect(valid).toBe(true);
  });

  it('Validate a user on any permissions and some', async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });
    const { permissionsGibbon } = user as TestUser;
    const { buffer } = permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAnyPermissions(
      toBuffer(buffer),
      [PERMISSION_POSITIONS_FIXTURES.USER, PERMISSION_POSITIONS_FIXTURES.ADMIN]
    );
    expect(valid).toBe(true);
  });

  it(`Validate a user on any permissions, but user hasn't got any group membership`, async () => {
    const user = await dbCollection.user.findOne({
      email: 'john@doe.born',
    });
    const { permissionsGibbon } = user as TestUser;
    const { buffer } = permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAnyPermissions(
      toBuffer(buffer),
      [
        PERMISSION_POSITIONS_FIXTURES.USER,
        PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
      ]
    );
    expect(valid).toBe(false);
  });

  it(`Validate a user on any permissions, but this user hasn't even got this one set`, async () => {
    const user = await dbCollection.user.findOne({
      name: /Arnold/,
    });
    const { permissionsGibbon } = user as TestUser;
    const { buffer } = permissionsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserPermissionsForAnyPermissions(
      toBuffer(buffer),
      [PERMISSION_POSITIONS_FIXTURES.ADMIN]
    );
    expect(valid).toBe(false);
  });

  it('Validate a user on all mandatory groups', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });
    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserGroupsForAllGroups(
      toBuffer(buffer),
      [GROUP_POSITION_FIXTURES.GI_JOE, GROUP_POSITION_FIXTURES.A_TEAM]
    );
    expect(valid).toBe(true);
  });

  it('Validate a user on any group(s)', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });

    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(
      toBuffer(buffer),
      [GROUP_POSITION_FIXTURES.GI_JOE]
    );
    expect(valid).toBe(true);
  });

  it('Validate a user on another group (any)', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });
    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(
      toBuffer(buffer),
      [GROUP_POSITION_FIXTURES.A_TEAM]
    );
    expect(valid).toBe(true);
  });

  it('Validate a user on any group, but is not member of this groups', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });
    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(
      toBuffer(buffer),
      [GROUP_POSITION_FIXTURES.PLANETEERS]
    );
    expect(valid).toBe(false);
  });

  it('Validate a user on any group, but should not be member of no groups', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });
    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;
    const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(
      toBuffer(buffer),
      []
    );
    expect(valid).toBe(false);
  });

  it('Fetch aggregated permissions for user', async () => {
    const user = await dbCollection.user.findOne({
      name: 'Captain Planet',
    });

    const { groupsGibbon } = user as TestUser;
    const { buffer } = groupsGibbon as Binary;

    const gibbon = await mongoDbAdapter.getPermissionsGibbonForGroups(
      Gibbon.decode(toBuffer(buffer))
    );

    const positions = gibbon.getPositionsArray();

    expect(positions).toEqual([
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      PERMISSION_POSITIONS_FIXTURES.USER,
      PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
    ]);
  });

  it('Validate some groups, which should be allocated in our database', async () => {
    const groupsGibbon = Gibbon.create(1024).setAllFromPositions([
      GROUP_POSITION_FIXTURES.GI_JOE,
    ]);
    const valid = await mongoDbAdapter.validateAllocatedGroups(groupsGibbon);

    expect(valid).toBe(true);
  });

  it('Validate some permissions, which should be allocated in our database', async () => {
    const permissionsGibbon = Gibbon.create(1024).setAllFromPositions([
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
    ]);
    const valid =
      await mongoDbAdapter.validateAllocatedPermissions(permissionsGibbon);

    expect(valid).toBe(true);
  });

  it('Subscribe a user to an allocated Group', async () => {
    const userBefore = await dbCollection.user.findOne({
      name: 'Cooper',
    });

    const { groupsGibbon: groupsBefore, permissionsGibbon: permissionsBefore } =
      userBefore as TestUser;
    const { buffer: groupsBufferBefore } = groupsBefore as Binary;
    const { buffer: permissionBufferBefore } = permissionsBefore as Binary;

    const groupPositionsBefore = Gibbon.decode(
      toBuffer(groupsBufferBefore)
    ).getPositionsArray();
    const permissionPositionsBefore = Gibbon.decode(
      toBuffer(permissionBufferBefore)
    ).getPositionsArray();

    expect(groupPositionsBefore).toEqual([GROUP_POSITION_FIXTURES.PLANETEERS]);
    expect(permissionPositionsBefore).toEqual([
      PERMISSION_POSITIONS_FIXTURES.USER,
      PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
    ]);

    await mongoDbAdapter.subscribeUsersToGroups({ name: /Cooper/ }, [
      GROUP_POSITION_FIXTURES.TRANSFORMERS,
    ]);

    const userAfter = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;

    const { groupsGibbon, permissionsGibbon } = userAfter;
    const { buffer: groupsBufferAfter } = groupsGibbon as Binary;
    const { buffer: permissionBufferAfter } = permissionsGibbon as Binary;

    const groupPositionsAfter = Gibbon.decode(
      toBuffer(groupsBufferAfter)
    ).getPositionsArray();
    const permissionPositionsAfter = Gibbon.decode(
      toBuffer(permissionBufferAfter)
    ).getPositionsArray();

    expect(groupPositionsAfter).toEqual(
      [
        GROUP_POSITION_FIXTURES.PLANETEERS,
        GROUP_POSITION_FIXTURES.TRANSFORMERS,
      ].sort()
    );
    expect(permissionPositionsAfter).toEqual(
      [
        PERMISSION_POSITIONS_FIXTURES.USER,
        PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        PERMISSION_POSITIONS_FIXTURES.ADMIN,
      ].sort()
    );
  });

  it('Subscribe Permissions To Groups', async () => {
    const userBefore = await dbCollection.user.findOne({
      name: 'Cooper',
    });
    const { groupsGibbon: groupsBefore, permissionsGibbon: permissionsBefore } =
      userBefore as TestUser;
    const { buffer: groupsBufferBefore } = groupsBefore as Binary;
    const { buffer: permissionBufferBefore } = permissionsBefore as Binary;

    const groupPositionsBefore = Gibbon.decode(
      toBuffer(groupsBufferBefore)
    ).getPositionsArray();
    const permissionPositionsBefore = Gibbon.decode(
      toBuffer(permissionBufferBefore)
    ).getPositionsArray();

    expect(groupPositionsBefore).toEqual([GROUP_POSITION_FIXTURES.PLANETEERS]);
    expect(permissionPositionsBefore).toEqual([
      PERMISSION_POSITIONS_FIXTURES.USER,
      PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
    ]);

    const permissions = Gibbon.create(1024).setAllFromPositions([
      PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
    ]);
    const groups = Gibbon.create(1024).setAllFromPositions([
      GROUP_POSITION_FIXTURES.PLANETEERS,
    ]);
    await mongoDbAdapter.subscribePermissionsToGroups(groups, permissions);

    const userAfter = await dbCollection.user.findOne({
      name: 'Cooper',
    });
    const { groupsGibbon: groupsAfter, permissionsGibbon: permissionsAfter } =
      userAfter as TestUser;

    const { buffer: groupsBufferAfter } = groupsAfter as Binary;
    const { buffer: permissionBufferAfter } = permissionsAfter as Binary;

    const groupPositionsAfter = Gibbon.decode(
      toBuffer(groupsBufferAfter)
    ).getPositionsArray();
    const permissionPositionsAfter = Gibbon.decode(
      toBuffer(permissionBufferAfter)
    ).getPositionsArray();

    expect(groupPositionsAfter).toEqual([GROUP_POSITION_FIXTURES.PLANETEERS]);
    expect(permissionPositionsAfter).toEqual([
      PERMISSION_POSITIONS_FIXTURES.USER,
      PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
      PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
    ]);
  });

  it('Create a user with initial empty gibbons', async () => {
    const user = (await mongoDbAdapter.createUser({
      name: 'New User',
      email: 'new@user.com',
    })) as TestUser;

    expect(user.name).toBe('New User');
    expect(user.email).toBe('new@user.com');
    expect(user.permissionsGibbon).toBeInstanceOf(Gibbon);
    expect(user.groupsGibbon).toBeInstanceOf(Gibbon);
    expect((user.permissionsGibbon as Gibbon).getPositionsArray()).toHaveLength(
      0
    );
    expect((user.groupsGibbon as Gibbon).getPositionsArray()).toHaveLength(0);
  });

  it('Find users by arbitrary filter', async () => {
    const users = (await mongoDbAdapter
      .findUsers({ name: /Arnold/ })
      .toArray()) as TestUser[];

    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Arnold Schwarzenegger');
    expect(users[0].permissionsGibbon).toBeInstanceOf(Gibbon);
  });

  it('Remove a user', async () => {
    await mongoDbAdapter.createUser({
      name: 'To Be Removed',
      email: 'remove@me.com',
    });

    const countBefore = (
      await mongoDbAdapter.findUsers({ email: 'remove@me.com' }).toArray()
    ).length;
    expect(countBefore).toBe(1);

    const removed = await mongoDbAdapter.removeUser({ email: 'remove@me.com' });
    expect(removed).toBe(1);

    const countAfter = (
      await mongoDbAdapter.findUsers({ email: 'remove@me.com' }).toArray()
    ).length;
    expect(countAfter).toBe(0);
  });

  it('List all allocated groups', async () => {
    const groups = (await mongoDbAdapter
      .findAllAllocatedGroups()
      .toArray()) as TestGroup[];

    expect(groups.length).toBeGreaterThanOrEqual(4);
    groups.forEach((group) => {
      expect(group.gibbonIsAllocated).toBe(true);
      expect(group.permissionsGibbon).toBeInstanceOf(Gibbon);
    });
  });

  it('List all allocated permissions', async () => {
    const permissions = (await mongoDbAdapter
      .findAllAllocatedPermissions()
      .toArray()) as TestPermission[];

    expect(permissions.length).toBeGreaterThanOrEqual(5);
    permissions.forEach((permission) => {
      expect(permission.gibbonIsAllocated).toBe(true);
    });
  });

  it('Update group metadata', async () => {
    const updated = (await mongoDbAdapter.updateGroupMetadata(
      GROUP_POSITION_FIXTURES.GI_JOE,
      { name: 'GI Joe Updated' }
    )) as TestGroup;

    expect(updated).not.toBeNull();
    expect(updated.name).toBe('GI Joe Updated');
    expect(updated.gibbonGroupPosition).toBe(GROUP_POSITION_FIXTURES.GI_JOE);
    expect(updated.gibbonIsAllocated).toBe(true);
    expect(updated.permissionsGibbon).toBeInstanceOf(Gibbon);

    // Restore original name
    await mongoDbAdapter.updateGroupMetadata(GROUP_POSITION_FIXTURES.GI_JOE, {
      name: 'GI Joe',
    });
  });

  it('Update group metadata returns null for non-allocated group', async () => {
    // Position 5 is not allocated in fixtures
    const result = await mongoDbAdapter.updateGroupMetadata(9999, {
      name: 'Should not work',
    });
    expect(result).toBeNull();
  });

  it('Update permission metadata', async () => {
    const updated = (await mongoDbAdapter.updatePermissionMetadata(
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      { name: 'God mode Updated' }
    )) as TestPermission;

    expect(updated).not.toBeNull();
    expect(updated.name).toBe('God mode Updated');
    expect(updated.gibbonPermissionPosition).toBe(
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE
    );
    expect(updated.gibbonIsAllocated).toBe(true);

    // Restore original name
    await mongoDbAdapter.updatePermissionMetadata(
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      { name: 'God mode' }
    );
  });

  it('Unsubscribe a user from a group', async () => {
    // Subscribe Cooper to TRANSFORMERS first
    await mongoDbAdapter.subscribeUsersToGroups({ name: /Cooper/ }, [
      GROUP_POSITION_FIXTURES.TRANSFORMERS,
    ]);

    const userBefore = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const groupsBefore = Gibbon.decode(
      Buffer.from((userBefore.groupsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(groupsBefore).toContain(GROUP_POSITION_FIXTURES.TRANSFORMERS);

    // Now unsubscribe from TRANSFORMERS
    await mongoDbAdapter.unsubscribeUsersFromGroups({ name: /Cooper/ }, [
      GROUP_POSITION_FIXTURES.TRANSFORMERS,
    ]);

    const userAfter = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const groupsAfter = Gibbon.decode(
      Buffer.from((userAfter.groupsGibbon as Binary).buffer)
    ).getPositionsArray();
    const permissionsAfter = Gibbon.decode(
      Buffer.from((userAfter.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();

    expect(groupsAfter).not.toContain(GROUP_POSITION_FIXTURES.TRANSFORMERS);
    expect(groupsAfter).toContain(GROUP_POSITION_FIXTURES.PLANETEERS);
    // Permissions should be recalculated from remaining groups (PLANETEERS only)
    expect(permissionsAfter).toContain(PERMISSION_POSITIONS_FIXTURES.USER);
    expect(permissionsAfter).toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);
    expect(permissionsAfter).not.toContain(PERMISSION_POSITIONS_FIXTURES.ADMIN);
  });

  it('Unsubscribe permissions from groups and recalculate user permissions', async () => {
    // Before: PLANETEERS has USER + THE_EDGE permissions
    // Cooper is member of PLANETEERS
    const userBefore = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const permsBefore = Gibbon.decode(
      Buffer.from((userBefore.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(permsBefore).toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);

    // Remove THE_EDGE from PLANETEERS
    await mongoDbAdapter.unsubscribePermissionsFromGroups(
      [GROUP_POSITION_FIXTURES.PLANETEERS],
      [PERMISSION_POSITIONS_FIXTURES.THE_EDGE]
    );

    // Check group no longer has THE_EDGE
    const groups = (await mongoDbAdapter
      .findGroups(
        Gibbon.create(1024).setPosition(GROUP_POSITION_FIXTURES.PLANETEERS)
      )
      .toArray()) as TestGroup[];
    const groupPerms = (
      groups[0].permissionsGibbon as Gibbon
    ).getPositionsArray();
    expect(groupPerms).not.toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);
    expect(groupPerms).toContain(PERMISSION_POSITIONS_FIXTURES.USER);

    // Check Cooper's permissions are recalculated
    const userAfter = (await dbCollection.user.findOne({
      name: 'Cooper',
    })) as TestUser;
    const permsAfter = Gibbon.decode(
      Buffer.from((userAfter.permissionsGibbon as Binary).buffer)
    ).getPositionsArray();
    expect(permsAfter).not.toContain(PERMISSION_POSITIONS_FIXTURES.THE_EDGE);
    expect(permsAfter).toContain(PERMISSION_POSITIONS_FIXTURES.USER);
  });

  it('Find permissions by positions', async () => {
    const positions = [
      PERMISSION_POSITIONS_FIXTURES.USER,
      PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
    ];
    const permissions = (await mongoDbAdapter
      .findPermissions(positions)
      .toArray()) as TestPermission[];

    expect(permissions).toBeInstanceOf(Array);
    expect(permissions).toHaveLength(2);

    // Find each permission in the results
    const userPerm = permissions.find(
      (p) => p.gibbonPermissionPosition === PERMISSION_POSITIONS_FIXTURES.USER
    );
    const edgePerm = permissions.find(
      (p) =>
        p.gibbonPermissionPosition === PERMISSION_POSITIONS_FIXTURES.THE_EDGE
    );

    expect(userPerm).toBeDefined();
    expect(edgePerm).toBeDefined();
    expect(userPerm?.name).toBe('User');
    expect(edgePerm?.name).toBe('C0ff3e MAcHiNe at the edge of sp@ce');
  });

  it('Update user metadata', async () => {
    const user = (await dbCollection.user.findOne({
      name: usersFixtures[0].name,
    })) as TestUser;
    expect(user.email).toBe(usersFixtures[0].email);

    const updated = await mongoDbAdapter.updateUserMetadata(
      { _id: user._id },
      { name: 'Updated Name', email: 'updated@example.com' }
    );

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.email).toBe('updated@example.com');
    // Ensure gibbons weren't modified
    expect(updated?.groupsGibbon).toBeInstanceOf(Gibbon);
    expect(updated?.permissionsGibbon).toBeInstanceOf(Gibbon);

    // Verify in database
    const fetched = (await dbCollection.user.findOne({
      _id: user._id,
    })) as TestUser;
    expect(fetched.name).toBe('Updated Name');
    expect(fetched.email).toBe('updated@example.com');
  });

  it('Should throw error when subscribing invalid (unallocated) permissions to groups', async () => {
    const validGroup = [GROUP_POSITION_FIXTURES.PLANETEERS];
    const invalidPermission = [999]; // Non-existent permission position

    await expect(
      mongoDbAdapter.subscribePermissionsToGroups(validGroup, invalidPermission)
    ).rejects.toThrow('Suggested permissions are not valid (not allocated)');
  });

  it('Should throw error when subscribing permissions to invalid (unallocated) groups', async () => {
    const invalidGroup = [999]; // Non-existent group position
    const validPermission = [PERMISSION_POSITIONS_FIXTURES.USER];

    await expect(
      mongoDbAdapter.subscribePermissionsToGroups(invalidGroup, validPermission)
    ).rejects.toThrow('Suggested groups are not valid (not allocated)');
  });

  it('Should throw error when subscribing users to invalid (unallocated) groups', async () => {
    const invalidGroup = [999]; // Non-existent group position

    await expect(
      mongoDbAdapter.subscribeUsersToGroups({ name: /Cooper/ }, invalidGroup)
    ).rejects.toThrow("Suggested groups aren't valid (not allocated)");
  });
});
