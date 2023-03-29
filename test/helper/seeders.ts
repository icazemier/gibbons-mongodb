import { Gibbon } from "@icazemier/gibbons";
import { MongoClient, UpdateResult } from "mongodb";
import { Config } from "../../src/interfaces/config.js";
import {
    permissionsFixtures,
    usersFixtures,
    groupsFixtures,
} from "./fixtures.js";

export const tearDownGroupTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    await mongoClient
        .db(config.dbStructure.group.dbName)
        .collection(config.dbStructure.group.collection)
        .deleteMany({});
};

export const tearDownPermissionTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    await mongoClient
        .db(config.dbStructure.permission.dbName)
        .collection(config.dbStructure.permission.collection)
        .deleteMany({});
};

export const tearDownUserTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    await mongoClient
        .db(config.dbStructure.user.dbName)
        .collection(config.dbStructure.user.collection)
        .deleteMany({});
};

export const seedUserTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    usersFixtures.forEach((user) => {
        const groups = Gibbon.decode(user.groupsGibbon).getPositionsArray();

        const groupsFiltered = groupsFixtures.filter(
            ({ gibbonGroupPosition }) => groups.includes(gibbonGroupPosition)
        );

        const permissionGibbon = Gibbon.create(config.permissionByteLength);
        groupsFiltered.forEach(({ permissionsGibbon }) => {
            permissionGibbon.mergeWithGibbon(Gibbon.decode(permissionsGibbon));
        });
        user.permissionsGibbon = permissionGibbon.encode() as Buffer;
    });

    await mongoClient
        .db(config.dbStructure.user.dbName)
        .collection(config.dbStructure.user.collection)
        .insertMany(usersFixtures);
};

export const seedPermissionTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    const permissionsPromises = permissionsFixtures.map(
        ({ name, gibbonPermissionPosition, gibbonIsAllocated }) => {
            return mongoClient
                .db(config.dbStructure.permission.dbName)
                .collection(config.dbStructure.permission.collection)
                .updateOne(
                    { gibbonPermissionPosition },
                    { $set: { name, gibbonIsAllocated } }
                );
        }
    ) as Promise<UpdateResult>[];

    await Promise.all(permissionsPromises);
};

export const seedGroupTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    const groupPromises = groupsFixtures.map(
        ({
            name,
            gibbonGroupPosition,
            permissionsGibbon,
            gibbonIsAllocated,
        }) => {
            return mongoClient
                .db(config.dbStructure.group.dbName)
                .collection(config.dbStructure.group.collection)
                .updateOne(
                    { gibbonGroupPosition },
                    { $set: { name, gibbonIsAllocated, permissionsGibbon } }
                );
        }
    );

    await Promise.all(groupPromises);
};

export const seedTestFixtures = async (
    mongoClient: MongoClient,
    config: Config
) => {
    await seedPermissionTestFixtures(mongoClient, config);
    await seedGroupTestFixtures(mongoClient, config);
};
