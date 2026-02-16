# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `findPermissions(positions)` - Find permission documents by their positions
- `updateUserMetadata(filter, data)` - Update custom fields on user documents
- `findAllAllocatedGroups()` - List all allocated group documents
- `findAllAllocatedPermissions()` - List all allocated permission documents
- `updateGroupMetadata(position, data)` - Update custom fields on group documents
- `updatePermissionMetadata(position, data)` - Update custom fields on permission documents
- `findUsers(filter)` - Find users by arbitrary MongoDB filter
- `createUser(data)` - Create users with initial empty gibbons
- `removeUser(filter)` - Remove users by MongoDB filter
- `unsubscribeUsersFromGroups(filter, groups)` - Remove group membership from users
- `unsubscribePermissionsFromGroups(groups, permissions)` - Remove permissions from groups

### Changed
- Modernized CI/CD pipelines (Node 18/20/22, GitHub Actions v4)
- Added `mongodb` as peer dependency
- Updated minimum Node.js version to 18
- Renamed `initialise()` to `initialize()` on MongoDbSeeder (old name kept as deprecated alias)

### Fixed
- Cleaned up `.npmignore` to match current project structure

## [0.x] - Previous releases

### Features
- Core bitwise group and permission management
- MongoDB persistence with Binary field storage
- Allocate/deallocate pattern for groups and permissions
- Subscribe/unsubscribe users to groups with cascading permission updates
- In-memory validation of user groups and permissions
- Node.js stream support via MongoDB FindCursor
- CLI tool for database initialization
- Cosmiconfig-based configuration
- Dual ESM/CJS build output
