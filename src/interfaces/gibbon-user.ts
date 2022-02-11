import { Gibbon } from "@icazemier/gibbons";
import { Binary, Document } from "mongodb";

export interface IGibbonUser extends Document {
    permissionsGibbon: Binary | Buffer | Gibbon;
    groupsGibbon: Binary | Buffer | Gibbon;
}
