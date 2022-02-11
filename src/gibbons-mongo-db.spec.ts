import { expect } from 'chai';
import { Gibbon } from '@icazemier/gibbons';
import { Binary, Collection, MongoClient, ObjectId } from 'mongodb';
import { writableNoopStream } from 'noop-stream';
import { pipeline, PassThrough } from 'stream';
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

describe('Happy flows ', () => {
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

        mongoDbAdapter = new GibbonsMongoDb(MongoDbTestServer.uri, config);
        await mongoDbAdapter.initialize();

        const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
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
                $bitsAnySet: Gibbon.create(1024)
                    .setAllFromPositions(groupPositions)
                    .encode() as Buffer,
            },
        };

        const testUser = await dbCollection.user.findOne(testUserfilter);

        console.log(`Test user: ${testUser?.email}`);

        const users = (await mongoDbAdapter
            .findUsersByGroups(groupPositions)
            .toArray()) as TestUser[];

        expect(users).to.be.an('array');
        expect(users).to.have.lengthOf(1);
        const [user] = users;

        expect(ObjectId.isValid(user._id)).to.equal(true);
        expect(user.name).to.equal(usersFixtures[2].name);
        expect(user.email).to.equal(usersFixtures[2].email);
        expect(
            Buffer.compare(
                (user.groupsGibbon as Gibbon).toBuffer(),
                usersFixtures[2].groupsGibbon
            )
        ).to.equal(0);
    });

    it('Find users by a group name with Gibbon', async () => {
        const groupsGibbon = Gibbon.create(2).setAllFromPositions([
            groupsFixtures[0].gibbonGroupPosition,
        ]);
        const users = (await mongoDbAdapter
            .findUsersByGroups(groupsGibbon)
            .toArray()) as TestUser[];

        expect(users).to.be.an('array');
        expect(users).to.have.lengthOf(1);
        const [user] = users;
        expect(ObjectId.isValid(user._id)).to.equal(true);
        expect(user.name).to.equal(usersFixtures[2].name);
        expect(user.email).to.equal(usersFixtures[2].email);
        expect(
            Buffer.compare(
                (user.groupsGibbon as Gibbon).toBuffer(),
                usersFixtures[2].groupsGibbon
            )
        ).to.equal(0);
    });

    it('Find users by permission name with positions', async () => {
        // 'God mode' => 'GI Joe' => 'Captain planet'

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

        expect(users).to.be.an('array');
        expect(users).to.have.lengthOf(1);
        const [user] = users;
        expect(ObjectId.isValid(user._id)).to.equal(true);
        expect(user.name).to.equal(usersFixtures[2].name);
        expect(user.email).to.equal(usersFixtures[2].email);
        expect(
            Buffer.compare(
                (user.groupsGibbon as Gibbon).toBuffer(),
                usersFixtures[2].groupsGibbon
            )
        ).to.equal(0);
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

        // Create a gibbon containing groups (info@arnieslife.com' 'captain@planet.nl should be members)
        const readableStream = mongoDbAdapter
            .findUsersByGroups(groupPositions)
            .stream();

        // Track the amount of assertions being done
        let assertions = 0;

        // Wrapper to test the stream
        const streamTestWrapper = () =>
            new Promise<void>((resolve, reject) => {
                const testStream = new PassThrough({ objectMode: true });

                testStream.on('data', (user) => {
                    assertions++;
                    expect(
                        ['info@arnieslife.com', 'captain@planet.nl'].includes(
                            user.email
                        )
                    ).to.equal(true);
                });

                // We're jump starting the stream with `writableNoopStream` to test the outcome
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
        expect(assertions).to.equal(2);
    });

    it('Find users by groups gibbon using Node.js streams', async () => {
        // Create a gibbon containing groups (info@arnieslife.com' 'captain@planet.nl should be members)
        const groupsGibbon = Gibbon.create(128).setAllFromPositions([
            groupsFixtures[2].gibbonGroupPosition,
        ]);
        const readableStream = mongoDbAdapter
            .findUsersByGroups(groupsGibbon)
            .stream();

        // Track the amount of assertions being done
        let assertions = 0;

        // Wrapper to test the stream
        const streamTestWrapper = () =>
            new Promise<void>((resolve, reject) => {
                const testStream = new PassThrough({ objectMode: true });

                testStream.on('data', (user) => {
                    assertions++;
                    expect(
                        ['info@arnieslife.com', 'captain@planet.nl'].includes(
                            user.email
                        )
                    ).to.equal(true);
                });

                // We're jump starting the stream with `writableNoopStream` to test the outcome
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
        expect(assertions).to.equal(2);
    });

    it('Find groups by permissions', async () => {
        // 'God mode' => 'GI Joe'

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
        expect(groups).to.be.an('array');
        expect(groups).to.have.lengthOf(1);
        const [group] = groups;
        expect(ObjectId.isValid(group._id)).to.equal(true);
        expect(group.name).to.equal(groupsFixtures[0].name);
        expect(
            Buffer.compare(
                (group.permissionsGibbon as Gibbon).toBuffer(),
                groupsFixtures[0].permissionsGibbon
            )
        ).to.equal(0);
        expect(group.gibbonGroupPosition).to.equal(
            groupsFixtures[0].gibbonGroupPosition
        );
        expect(group.gibbonIsAllocated).to.equal(
            groupsFixtures[0].gibbonIsAllocated
        );
    });

    it('Allocate a permission, check before and after', async () => {
        // Because of our existing populated fixtures we expect the createPermission function to
        // create the first available non-allocated permission to be allocated at this point
        const expectedToAllocateToPosition =
            PERMISSION_POSITIONS_FIXTURES.GOD_MODE + 1;

        const nonAllocatedPermission = (await dbCollection.permission.findOne({
            gibbonPermissionPosition: expectedToAllocateToPosition,
        })) as TestPermission;

        expect(nonAllocatedPermission.gibbonPermissionPosition).to.equal(
            expectedToAllocateToPosition
        );
        expect(Boolean(nonAllocatedPermission.name)).to.equal(false);
        expect(nonAllocatedPermission.gibbonIsAllocated).to.equal(false);

        const permissionToCreate = {
            name: 'Able to create a shopping basket',
        } as TestPermission;
        const permission =
            (await mongoDbAdapter.allocatePermission<TestPermission>(
                permissionToCreate
            )) as TestPermission;

        expect(permission.name).to.equal(permissionToCreate.name);
        expect(permission.gibbonIsAllocated).to.equal(true);
        expect(permission.gibbonPermissionPosition).to.equal(
            expectedToAllocateToPosition
        );
    });

    it('Allocate some permissions on groups, then deallocate them and check groups for permissions', async () => {
        // Prepare some permissions (which will be removed later)
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
        const permissionPositions = [
            position1,
            position2,
            position3,
        ] as Array<number>;

        // Fetch an existing group from fixtures (to store these permissions on)
        const groupBefore = (await dbCollection.group.findOne({
            name: 'GI Joe',
        })) as TestGroup;

        const {
            permissionsGibbon,
            gibbonGroupPosition: gibbonGroupPositionBefore,
        } = groupBefore;

        const { buffer: bufferBefore } = permissionsGibbon as Binary;

        const gibbonPermissionsBefore = Gibbon.decode(bufferBefore)
            .setAllFromPositions(permissionPositions)
            .encode() as Buffer;

        // Update permissions for this group
        await dbCollection.group.findOneAndUpdate(
            {
                gibbonGroupPosition: gibbonGroupPositionBefore,
            },
            {
                $set: { permissionsGibbon: gibbonPermissionsBefore },
            }
        );

        // Ensure we've got user subscribed to these groups / permissions
        const usersBefore = [
            {
                email: 'test1@test.com',
                name: 'Test 1',
                groupsGibbon: Gibbon.create(1024)
                    .setPosition(GROUP_POSITION_FIXTURES.GI_JOE)
                    .encode() as Buffer,
                permissionsGibbon: gibbonPermissionsBefore,
            },
            {
                email: 'test2@test.com',
                name: 'Test 2',
                groupsGibbon: Gibbon.create(1024)
                    .setPosition(GROUP_POSITION_FIXTURES.GI_JOE)
                    .encode() as Buffer,
                permissionsGibbon: gibbonPermissionsBefore,
            },
        ] as TestUser[];
        await dbCollection.user.insertMany(usersBefore);

        // Finally test "deallocate" and see if the permissions are deallocated and the test group is updated
        await mongoDbAdapter.deallocatePermissions(permissionPositions);

        // These permissions should be deallocated by now (these are reset to defaults)
        const permissions = await dbCollection.permission
            .find({ gibbonPermissionPosition: { $in: permissionPositions } })
            .toArray();

        expect(permissions.length).to.equal(permissionPositions.length);
        permissions.forEach((permission) => {
            expect(
                permissionPositions.includes(
                    permission.gibbonPermissionPosition
                )
            ).to.equal(true);
            expect(ObjectId.isValid(permission._id)).to.equal(true);
            expect(permission.gibbonPermissionPosition).to.be.a('number');
            expect(permission.gibbonIsAllocated).to.equal(false);
            expect(Boolean(permission.name)).to.equal(false);
        });

        const [groupAfter] = await dbCollection.group
            .find({ name: 'GI Joe' })
            .toArray();
        const { permissionsGibbon: permissionsAfter } = groupAfter;
        const { buffer: bufferAfter } = permissionsAfter as Binary;
        const gibbonAfter = Gibbon.decode(bufferAfter);

        // We expect the group to still have the one stored from fixtures
        const positionsAfter = gibbonAfter.getPositionsArray();
        expect(positionsAfter).to.be.an('array');
        expect(positionsAfter).to.have.lengthOf(1);
        expect(positionsAfter).to.include(GROUP_POSITION_FIXTURES.GI_JOE);

        // These should be set in the corresponding group, as we deallocated them:
        const hasAnyAfter =
            gibbonAfter.hasAnyFromPositions(permissionPositions);
        expect(hasAnyAfter).to.equal(false);

        // Check users on their subscriptions
        const usersAfter = await dbCollection.user
            .find({ email: /test.com/ })
            .toArray();

        usersAfter.forEach((user) => {
            const { buffer: permissionBuffer } =
                user.permissionsGibbon as Binary;
            const { buffer: groupBuffer } = user.groupsGibbon as Binary;
            const permissionPositionsGibbon = Gibbon.decode(permissionBuffer);
            // Permissions should be gone
            expect(
                permissionPositionsGibbon.hasAnyFromPositions(
                    permissionPositions
                )
            ).to.equal(false);

            // But group should stay
            const groupPositionsGibbon = Gibbon.decode(groupBuffer);
            expect(
                groupPositionsGibbon.hasAnyFromPositions([
                    GROUP_POSITION_FIXTURES.GI_JOE,
                ])
            ).to.equal(true);
        });
    });

    it('Allocate some groups on user, then deallocate them and check users for groups', async () => {
        // Allocate groups
        const { gibbonGroupPosition: position1 } =
            await mongoDbAdapter.allocateGroup({
                name: 'My allocated test group 1 (should be position 3)',
            } as TestGroup);
        const { gibbonGroupPosition: position2 } =
            await mongoDbAdapter.allocateGroup({
                name: 'My allocated test group 2 (should be position 4)',
            } as TestGroup);

        // Because these weren't allocated yet, and the first to be allocated (See fixtures)
        expect(position1).to.equal(3);
        expect(position2).to.equal(4);

        // Make users member of these groups
        const userBefore = await dbCollection.user.findOne({
            email: 'captain@planet.nl',
        });

        const { groupsGibbon: groupsBefore, _id } = userBefore as TestUser;
        const { buffer: groupsBufferBefore } = groupsBefore as Binary;
        // Get current group subscriptions for this user
        const groupsGibbonBefore = Gibbon.decode(groupsBufferBefore);
        const isMemberOfGroupsBefore = groupsGibbonBefore.hasAnyFromPositions([
            position1,
            position2,
        ]);

        // Be sure we aren't yet a member of these groups
        expect(isMemberOfGroupsBefore).to.equal(false);

        // Now we enable these groups and update the user
        groupsGibbonBefore.setAllFromPositions([position1, position2]);
        await dbCollection.user.updateOne(
            { _id },
            { $set: { groupsGibbon: groupsGibbonBefore.encode() } }
        );

        // THE TEST: Deallocate groups nowwww!
        await mongoDbAdapter.deallocateGroups([position1, position2]);

        // Test if groups are deallocated and this user isn't a member of these groups anymore
        const userAfter = await dbCollection.user.findOne({
            _id,
        });
        const { groupsGibbon } = userAfter as TestUser;

        const { buffer: groupsBufferAfter } = groupsGibbon as Binary;

        const hasGroupsAfter = Gibbon.decode(
            groupsBufferAfter
        ).hasAnyFromPositions([position1, position2]);
        expect(hasGroupsAfter).to.equal(false);
    });

    it('Find Groups By User', async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });

        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;

        const gibbon = Gibbon.decode(buffer);
        const groupsFromDB = (await mongoDbAdapter
            .findGroups(gibbon)
            .toArray()) as TestGroup[];
        expect(groupsFromDB).to.be.an('array');
        expect(groupsFromDB).to.have.lengthOf(1);

        const [groupFromDB] = groupsFromDB;
        const { _id, permissionsGibbon, ...group } = groupFromDB;
        const groupFromFixture = groupsFixtures[2];

        const gibbonFromFixtures = Gibbon.fromBuffer(
            groupFromFixture.permissionsGibbon
        );

        expect(ObjectId.isValid(_id)).to.equal(true);
        expect(gibbonFromFixtures.equals(permissionsGibbon as Gibbon)).to.equal(
            true
        );
        expect(group.gibbonGroupPosition).to.equal(
            groupFromFixture.gibbonGroupPosition
        );
        expect(group.gibbonIsAllocated).to.equal(true);
    });

    it('Validate a user on all mandatory permissions', async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { buffer } = user!.permissionsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
            buffer,
            [
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
            ]
        );
        expect(valid).to.equal(true);
    });

    it(`Validate a user on all mandatory permissions, where Arnold hasn't got them all`, async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { buffer } = user!.permissionsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
            buffer,
            [
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
                PERMISSION_POSITIONS_FIXTURES.ADMIN,
            ]
        );
        expect(valid).to.equal(false);
    });

    it(`Validate a user on all mandatory permissions, but user hasn't got any group membership`, async () => {
        const user = await dbCollection.user.findOne({
            email: 'john@doe.born',
        });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { buffer } = user!.permissionsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserPermissionsForAllPermissions(
            buffer,
            [
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
            ]
        );
        expect(valid).to.equal(false);
    });

    it('Validate a user on any permissions', async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });

        const { permissionsGibbon } = user as TestUser;
        const { buffer } = permissionsGibbon as Binary;
        const valid =
            await mongoDbAdapter.validateUserPermissionsForAnyPermissions(
                buffer,
                [PERMISSION_POSITIONS_FIXTURES.USER]
            );
        expect(valid).to.equal(true);
    });

    it('Validate a user on any permissions and some', async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });
        const { permissionsGibbon } = user as TestUser;
        const { buffer } = permissionsGibbon as Binary;
        const valid =
            await mongoDbAdapter.validateUserPermissionsForAnyPermissions(
                buffer,
                [
                    PERMISSION_POSITIONS_FIXTURES.USER,
                    PERMISSION_POSITIONS_FIXTURES.ADMIN,
                ]
            );
        expect(valid).to.equal(true);
    });

    it(`Validate a user on any permissions, but user hasn't got any group membership`, async () => {
        const user = await dbCollection.user.findOne({
            email: 'john@doe.born',
        });
        const { permissionsGibbon } = user as TestUser;
        const { buffer } = permissionsGibbon as Binary;
        const valid =
            await mongoDbAdapter.validateUserPermissionsForAnyPermissions(
                buffer,
                [
                    PERMISSION_POSITIONS_FIXTURES.USER,
                    PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
                ]
            );
        expect(valid).to.equal(false);
    });

    it(`Validate a user on any permissions, but this user hasn't even got this one set`, async () => {
        const user = await dbCollection.user.findOne({
            name: /Arnold/,
        });
        const { permissionsGibbon } = user as TestUser;
        const { buffer } = permissionsGibbon as Binary;
        const valid =
            await mongoDbAdapter.validateUserPermissionsForAnyPermissions(
                buffer,
                [PERMISSION_POSITIONS_FIXTURES.ADMIN]
            );
        expect(valid).to.equal(false);
    });

    it('Validate a user on all mandatory groups', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });
        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserGroupsForAllGroups(buffer, [
            GROUP_POSITION_FIXTURES.GI_JOE,
            GROUP_POSITION_FIXTURES.A_TEAM,
        ]);
        expect(valid).to.equal(true);
    });

    it('Validate a user on any group(s)', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });

        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(buffer, [
            GROUP_POSITION_FIXTURES.GI_JOE,
        ]);
        expect(valid).to.equal(true);
    });

    it('Validate a user on another group (any)', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });
        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(buffer, [
            GROUP_POSITION_FIXTURES.A_TEAM,
        ]);
        expect(valid).to.equal(true);
    });

    it('Validate a user on any group, but is not member of this groups', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });
        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(buffer, [
            GROUP_POSITION_FIXTURES.PLANETEERS,
        ]);
        expect(valid).to.equal(false);
    });

    it('Validate a user on any group, but should not be member of no groups', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });
        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;
        const valid = mongoDbAdapter.validateUserGroupsForAnyGroups(buffer, []);
        expect(valid).to.equal(false);
    });

    it('Fetch aggregated permissions for user', async () => {
        const user = await dbCollection.user.findOne({
            name: 'Captain Planet',
        });

        const { groupsGibbon } = user as TestUser;
        const { buffer } = groupsGibbon as Binary;

        const gibbon = await mongoDbAdapter.getPermissionsGibbonForGroups(
            Gibbon.decode(buffer)
        );

        const positions = gibbon.getPositionsArray();

        expect(positions).to.deep.equal([
            PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
            PERMISSION_POSITIONS_FIXTURES.USER,
            PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
        ]);
    });

    it('Validate some groups, which should be allocated in our database', async () => {
        const groupsGibbon = Gibbon.create(1024).setAllFromPositions([
            GROUP_POSITION_FIXTURES.GI_JOE,
        ]);
        const valid = await mongoDbAdapter.validateAllocatedGroups(
            groupsGibbon
        );

        expect(valid).to.equal(true);
    });

    it('Validate some permissions, which should be allocated in our database', async () => {
        const permissionsGibbon = Gibbon.create(1024).setAllFromPositions([
            PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
            PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        ]);
        const valid = await mongoDbAdapter.validateAllocatedPermissions(
            permissionsGibbon
        );

        expect(valid).to.equal(true);
    });

    it('Subscribe a user to an allocated Group', async () => {
        // Pick a user
        const userBefore = await dbCollection.user.findOne({
            name: 'Cooper',
        });

        // Keep their group and permission subscriptions in mind
        const {
            groupsGibbon: groupsBefore,
            permissionsGibbon: permissionsBefore,
        } = userBefore as TestUser;
        const { buffer: groupsBufferBefore } = groupsBefore as Binary;
        const { buffer: permissionBufferBefore } = permissionsBefore as Binary;

        const groupPositionsBefore =
            Gibbon.decode(groupsBufferBefore).getPositionsArray();
        const permissionPositionsBefore = Gibbon.decode(
            permissionBufferBefore
        ).getPositionsArray();

        expect(groupPositionsBefore).to.deep.equal([
            GROUP_POSITION_FIXTURES.PLANETEERS,
        ]);
        expect(permissionPositionsBefore).to.deep.equal([
            PERMISSION_POSITIONS_FIXTURES.USER,
            PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        ]);

        // Execute and subscribe user to a new group
        // This should subscribe this user to the new group, but also
        // The corresponding permissions should ben in there.
        await mongoDbAdapter.subscribeUsersToGroups({ name: /Cooper/ }, [
            GROUP_POSITION_FIXTURES.TRANSFORMERS,
        ]);

        const userAfter = (await dbCollection.user.findOne({
            name: 'Cooper',
        })) as TestUser;

        const { groupsGibbon, permissionsGibbon } = userAfter;
        const { buffer: groupsBufferAfter } = groupsGibbon as Binary;
        const { buffer: permissionBufferAfter } = permissionsGibbon as Binary;

        const groupPositionsAfter =
            Gibbon.decode(groupsBufferAfter).getPositionsArray();
        const permissionPositionsAfter = Gibbon.decode(
            permissionBufferAfter
        ).getPositionsArray();

        expect(groupPositionsAfter).to.deep.equal(
            [
                GROUP_POSITION_FIXTURES.PLANETEERS,
                GROUP_POSITION_FIXTURES.TRANSFORMERS,
            ].sort()
        );
        // Because group "transformers" has "admin" as permission:
        expect(permissionPositionsAfter).to.deep.equal(
            [
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
                PERMISSION_POSITIONS_FIXTURES.ADMIN,
            ].sort()
        );
    });

    it('Subscribe Permissions To Groups', async () => {
        // Pick a user
        const userBefore = await dbCollection.user.findOne({
            name: 'Cooper',
        });
        // Keep their group and permission subscriptions in mind
        const {
            groupsGibbon: groupsBefore,
            permissionsGibbon: permissionsBefore,
        } = userBefore as TestUser;
        const { buffer: groupsBufferBefore } = groupsBefore as Binary;
        const { buffer: permissionBufferBefore } = permissionsBefore as Binary;

        const groupPositionsBefore =
            Gibbon.decode(groupsBufferBefore).getPositionsArray();
        const permissionPositionsBefore = Gibbon.decode(
            permissionBufferBefore
        ).getPositionsArray();

        expect(groupPositionsBefore).to.deep.equal([
            GROUP_POSITION_FIXTURES.PLANETEERS,
        ]);
        expect(permissionPositionsBefore).to.deep.equal([
            PERMISSION_POSITIONS_FIXTURES.USER,
            PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        ]);

        // Add a permission to an existing group:
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
        const {
            groupsGibbon: groupsAfter,
            permissionsGibbon: permissionsAfter,
        } = userAfter as TestUser;

        const { buffer: groupsBufferAfter } = groupsAfter as Binary;
        const { buffer: permissionBufferAfter } = permissionsAfter as Binary;

        const groupPositionsAfter =
            Gibbon.decode(groupsBufferAfter).getPositionsArray();
        const permissionPositionsAfter = Gibbon.decode(
            permissionBufferAfter
        ).getPositionsArray();

        expect(groupPositionsAfter).to.deep.equal([
            GROUP_POSITION_FIXTURES.PLANETEERS,
        ]);
        expect(permissionPositionsAfter).to.deep.equal([
            PERMISSION_POSITIONS_FIXTURES.USER,
            PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
            PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        ]);
    });
});

// describe("Unhappy flows", () => {
//     xit("Try to pass wrong data", async () => {

//         const mongoDbAdapter = new GibbonsMongoDb(MongoDbTestServer.uri, config);
//         const throwsError = async () => {
//             mongoDbAdapter.ensureGibbon("wrong data type" as unknown as Buffer);
//         };

//         await expect(throwsError()).to.be.rejectedWith(
//             "`Gibbon`, `Array<number>` or `Buffer` expected"
//         );
//     });
// });
