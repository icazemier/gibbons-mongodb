import { Gibbon } from "@icazemier/gibbons";

enum GROUP_POSITION_FIXTURES {
    GI_JOE = 1,
    TRANSFORMERS = 2,
    A_TEAM = 1023,
    PLANETEERS = 2047,
}

enum PERMISSION_POSITIONS_FIXTURES {
    GOD_MODE = 1,
    ADMIN = 4,
    USER = 5,
    BACK_DOOR = 10,
    THE_EDGE = 8091, // 1024 * 8 = 8092
}

const usersFixtures = [
    {
        email: "info@arnieslife.com",
        name: "Arnold Schwarzenegger",
        groupsGibbon: Gibbon.create(1024)
            .setPosition(GROUP_POSITION_FIXTURES.A_TEAM)
            .encode() as Buffer,
        permissionsGibbon: Buffer.alloc(1),
    },
    {
        email: "info@knightrideronline.com",
        name: "Michael Knight",
        groupsGibbon: Gibbon.create(1024)
            .setPosition(GROUP_POSITION_FIXTURES.TRANSFORMERS)
            .encode() as Buffer,
        permissionsGibbon: Buffer.alloc(1),
    },
    {
        email: "captain@planet.nl",
        name: "Captain Planet",
        groupsGibbon: Gibbon.create(1024)
            .setAllFromPositions([
                GROUP_POSITION_FIXTURES.GI_JOE,
                GROUP_POSITION_FIXTURES.A_TEAM,
            ])
            .encode() as Buffer,
        permissionsGibbon: Buffer.alloc(1),
    },
    {
        email: "mankind@earth.born",
        name: "Cooper",
        groupsGibbon: Gibbon.create(1024)
            .setPosition(GROUP_POSITION_FIXTURES.PLANETEERS)
            .encode() as Buffer,
        permissionsGibbon: Buffer.alloc(1),
    },
    {
        email: "john@doe.born",
        name: "John",
        // No group, means no permissions ;)
        groupsGibbon: Gibbon.create(1024).encode() as Buffer,
        permissionsGibbon: Buffer.alloc(1),
    },
];

const groupsFixtures = [
    {
        name: "GI Joe",
        permissionsGibbon: Gibbon.create(1024)
            .setPosition(PERMISSION_POSITIONS_FIXTURES.GOD_MODE)
            .encode() as Buffer,
        gibbonGroupPosition: GROUP_POSITION_FIXTURES.GI_JOE,
        gibbonIsAllocated: true,
    },
    {
        name: `Auto's in disguise`,
        permissionsGibbon: Gibbon.create(1024)
            .setAllFromPositions([PERMISSION_POSITIONS_FIXTURES.ADMIN])
            .encode() as Buffer,
        gibbonGroupPosition: GROUP_POSITION_FIXTURES.TRANSFORMERS,
        gibbonIsAllocated: true,
    },
    {
        name: "A-Team",
        permissionsGibbon: Gibbon.create(1024)
            .setAllFromPositions([
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
            ])
            .encode() as Buffer,
        gibbonGroupPosition: GROUP_POSITION_FIXTURES.A_TEAM,
        gibbonIsAllocated: true,
    },
    {
        name: "Planeteers",
        permissionsGibbon: Gibbon.create(1024)
            .setAllFromPositions([
                PERMISSION_POSITIONS_FIXTURES.USER,
                PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
            ])
            .encode() as Buffer,
        gibbonGroupPosition: GROUP_POSITION_FIXTURES.PLANETEERS,
        gibbonIsAllocated: true,
    },
];

const permissionsFixtures = [
    {
        name: "God mode",
        gibbonPermissionPosition: PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
        gibbonIsAllocated: true,
    },
    {
        name: "Admin",
        gibbonPermissionPosition: PERMISSION_POSITIONS_FIXTURES.ADMIN,
        gibbonIsAllocated: true,
    },
    {
        name: "User",
        gibbonPermissionPosition: PERMISSION_POSITIONS_FIXTURES.USER,
        gibbonIsAllocated: true,
    },
    {
        name: "Back door",
        gibbonPermissionPosition: PERMISSION_POSITIONS_FIXTURES.BACK_DOOR,
        gibbonIsAllocated: true,
    },
    {
        name: "C0ff3e MAcHiNe at the edge of sp@ce",
        gibbonPermissionPosition: PERMISSION_POSITIONS_FIXTURES.THE_EDGE,
        gibbonIsAllocated: true,
    },
];

export {
    usersFixtures,
    groupsFixtures,
    permissionsFixtures,
    GROUP_POSITION_FIXTURES,
    PERMISSION_POSITIONS_FIXTURES,
};
