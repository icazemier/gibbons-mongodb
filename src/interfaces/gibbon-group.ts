import { Gibbon } from "@icazemier/gibbons";
import { Binary, Document } from "mongodb";

export interface IGibbonGroup extends Document {
    permissionsGibbon: Binary | Buffer | Gibbon;
    gibbonGroupPosition: number;
    gibbonIsAllocated: boolean;
}
