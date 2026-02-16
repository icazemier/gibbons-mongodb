import { Buffer } from 'node:buffer';
import { Gibbon } from '@icazemier/gibbons';
import { Binary, Document } from 'mongodb';

/**
 * Represents a user document stored in MongoDB.
 * Each user has a bitwise mask for group memberships and aggregated permissions.
 */
export interface IGibbonUser extends Document {
  /** Bitwise mask of aggregated permissions derived from group memberships */
  permissionsGibbon: Binary | Buffer | Gibbon;
  /** Bitwise mask of groups this user is subscribed to */
  groupsGibbon: Binary | Buffer | Gibbon;
}
