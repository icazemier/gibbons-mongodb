import { Gibbon } from "@icazemier/gibbons";
import { Binary, Document, ObjectId } from "mongodb";

export interface IGibbonUser extends Document {
    _id: ObjectId;
    permissionsGibbon?: Buffer | Binary | Gibbon | { $bitsAnySet: Buffer };
    groupsGibbon?:
        | Buffer
        | Binary
        | Gibbon
        | {
              $bitsAnySet: Buffer;
          };
}
