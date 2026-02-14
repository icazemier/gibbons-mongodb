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
 * Collection name configuration for each entity type.
 */
export interface DbStructure {
  user: { collectionName: string };
  group: { collectionName: string };
  permission: { collectionName: string };
}

/**
 * Configuration for the gibbons-mongodb library.
 */
export interface Config {
  /** MongoDB database name shared by all collections */
  dbName: string;
  /** Number of bytes for the permissions Gibbon (max permissions = byteLength * 8) */
  permissionByteLength: number;
  /** Number of bytes for the groups Gibbon (max groups = byteLength * 8) */
  groupByteLength: number;
  /** Concurrency limit for bulk MongoDB mutations */
  mongoDbMutationConcurrency: number;
  /** Collection structure for each entity type */
  dbStructure: DbStructure;
}
