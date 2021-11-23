import { Gibbon } from '@icazemier/gibbons';

/**
 * Interface for resources that can resolve aggregated permissions from groups.
 * Used as a dependency injection point so that user operations can
 * recalculate permissions without a circular dependency.
 */
export interface IPermissionsResource {
  /**
   * Fetches the aggregated permissions Gibbon for the given groups.
   *
   * @param groups - Gibbon representing group memberships
   * @returns Gibbon with all permissions from the given groups merged together
   */
  getPermissionsGibbonForGroups(groups: Gibbon): Promise<Gibbon>;
}
