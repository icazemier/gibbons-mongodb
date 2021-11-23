import {
  IGibbonGroup,
  IGibbonPermission,
  IGibbonUser,
} from '../../src/interfaces/index.js';

export interface TestUser extends IGibbonUser {
  email: string;
  name: string;
}

export interface TestPermission extends IGibbonPermission {
  name: string;
}

export interface TestGroup extends IGibbonGroup {
  name: string;
}
