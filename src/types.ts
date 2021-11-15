import { Gibbon } from "@icazemier/gibbons";
import { Collection } from "mongodb";

export interface DbCollection {
    user: Collection;
    group: Collection;
    permission: Collection;
}

export interface GibbonUser {
    groupsGibbon: Gibbon;
    permissionsGibbon: Gibbon;
}

export interface GibbonGroup {
    permissionsGibbon: Gibbon;
    gibbonGroupPosition: number;
    gibbonIsAllocated: boolean;
}

export interface GibbonPermission {
    gibbonPermissionPosition: number;
    gibbonIsAllocated: boolean;
}

export interface DbStructure {
    user: {
        dbName: string;
        collection: string;
        fields: {
            groupsGibbon: string;
            permissionsGibbon: string;
        };
    };
    group: {
        dbName: string;
        collection: string;
        fields: {
            permissionsGibbon: string;
            gibbonGroupPosition: string;
            gibbonIsAllocated: string;
        };
    };
    permission: {
        dbName: string;
        collection: string;
        fields: {
            gibbonPermissionPosition: string;
            gibbonIsAllocated: string;
        };
    };
}

export interface Config {
    permissionByteLength: number;
    groupByteLength: number;
    mongoDbMutationConcurrency: number;
    dbStructure: DbStructure;
}
