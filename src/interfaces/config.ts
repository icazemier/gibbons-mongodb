import { Collection } from "mongodb";
import { IGibbonGroup } from "./gibbon-group.js";
import { IGibbonPermission } from "./gibbon-permission.js";
import { IGibbonUser } from "./gibbon-user.js";

export interface DbCollection {
    user: Collection<IGibbonUser>;
    group: Collection<IGibbonGroup>;
    permission: Collection<IGibbonPermission>;
}

export interface DbStructure {
    user: {
        dbName: string;
        collection: string;
    };
    group: {
        dbName: string;
        collection: string;
    };
    permission: {
        dbName: string;
        collection: string;
    };
}

export interface Config {
    permissionByteLength: number;
    groupByteLength: number;
    mongoDbMutationConcurrency: number;
    dbStructure: DbStructure;
}
