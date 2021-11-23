import { Gibbon } from '@icazemier/gibbons';
import { Binary, Document } from 'mongodb';

/**
 * Utility type that omits the `gibbonGroupPosition` field from a group-like type.
 * Used when allocating new groups where the position is assigned automatically.
 */
export type OmitGibbonGroupPosition<T extends { gibbonGroupPosition: number }> =
  Omit<T, 'gibbonGroupPosition'>;

/**
 * Represents a group document stored in MongoDB.
 * Each group has a unique position, an allocation status, and a bitwise permissions mask.
 */
export interface IGibbonGroup extends Document {
  /** Bitwise mask of permissions subscribed to this group */
  permissionsGibbon: Binary | Buffer | Gibbon;
  /** Unique 1-based position identifying this group in the bitwise system */
  gibbonGroupPosition: number;
  /** Whether this group slot has been allocated for use */
  gibbonIsAllocated: boolean;
}
