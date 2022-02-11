import { Gibbon } from '@icazemier/gibbons';
import { Binary, Document } from 'mongodb';

export type OmitGibbonGroupPosition<T extends { gibbonGroupPosition: any }> =
    Omit<T, 'gibbonGroupPosition'>;
export interface IGibbonGroup extends Document {
    permissionsGibbon: Binary | Buffer | Gibbon;
    gibbonGroupPosition: number;
    gibbonIsAllocated: boolean;
}
