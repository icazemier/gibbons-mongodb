import { Document } from 'mongodb';

/**
 * Represents a permission document stored in MongoDB.
 * Each permission has a unique position and an allocation status.
 */
export interface IGibbonPermission extends Document {
  /** Unique 1-based position identifying this permission in the bitwise system */
  gibbonPermissionPosition: number;
  /** Whether this permission slot has been allocated for use */
  gibbonIsAllocated: boolean;
}
