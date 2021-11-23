import { Gibbon } from "@icazemier/gibbons";
import { Binary, ObjectId } from "mongodb";

export interface IGibbonGroup {
    _id: ObjectId;
    permissionsGibbon: Binary | Gibbon | Buffer | { $bitsAnySet: Buffer };
    gibbonGroupPosition: number;
    gibbonIsAllocated: boolean | { $ne: boolean };
}
