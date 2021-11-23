import { Collection } from 'mongodb';
import { IGibbonGroup } from './gibbon-group.js';
import { IGibbonPermission } from './gibbon-permission.js';
import { IGibbonUser } from './gibbon-user.js';

/**
 * Typed MongoDB collection references for users, groups and permissions.
 */
export interface DbCollection {
  user: Collection<IGibbonUser>;
  group: Collection<IGibbonGroup>;
  permission: Collection<IGibbonPermission>;
}

/**
 * Database and collection name pairs for each entity type.
 */
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

/**
 * Configuration for the gibbons-mongodb library.
 */
export interface Config {
  /** Number of bytes for the permissions Gibbon (max permissions = byteLength * 8) */
  permissionByteLength: number;
  /** Number of bytes for the groups Gibbon (max groups = byteLength * 8) */
  groupByteLength: number;
  /** Concurrency limit for bulk MongoDB mutations */
  mongoDbMutationConcurrency: number;
  /** Database and collection structure for each entity type */
  dbStructure: DbStructure;
}
