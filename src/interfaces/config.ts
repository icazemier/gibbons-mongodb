import { Collection } from 'mongodb';
import { IGibbonGroup, IGibbonPermission, IGibbonUser } from './index.js';

export interface DbCollection {
    user: Collection<IGibbonUser>;
    group: Collection<IGibbonGroup>;
    permission: Collection<IGibbonPermission>;
}

export interface DbStructure {
    user: {
        dbName: string;
        collectionName: string;
    };
    group: {
        dbName: string;
        collectionName: string;
    };
    permission: {
        dbName: string;
        collectionName: string;
    };
}

export interface Config {
    permissionByteLength: number;
    groupByteLength: number;
    mongoDbMutationConcurrency: number;
    dbStructure: DbStructure;
}
