import { Gibbon } from '@icazemier/gibbons';

export interface IPermissionsResource {
    getPermissionsGibbonForGroups(groups: Gibbon): Promise<Gibbon>;
}
