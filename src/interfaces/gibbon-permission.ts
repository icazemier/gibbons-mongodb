import { Document } from 'mongodb';

export interface IGibbonPermission extends Document {
    gibbonPermissionPosition: number;
    gibbonIsAllocated: boolean;
}
