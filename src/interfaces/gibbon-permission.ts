import { ObjectId } from "mongodb";

export interface IGibbonPermission {
    _id: ObjectId;
    gibbonPermissionPosition: number;
    gibbonIsAllocated: boolean;
}
