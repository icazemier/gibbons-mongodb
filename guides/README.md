# @icazemier/gibbons-mongodb

> Bitwise user groups and permissions management for MongoDB

[![CI](https://github.com/icazemier/gibbons-mongodb/actions/workflows/ci.yml/badge.svg)](https://github.com/icazemier/gibbons-mongodb/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@icazemier/gibbons-mongodb)](https://www.npmjs.com/package/@icazemier/gibbons-mongodb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

gibbons-mongodb is a Node.js library that manages user groups and permissions using bitwise operations for maximum efficiency. It provides a MongoDB persistence layer on top of [@icazemier/gibbons](https://github.com/icazemier/gibbons), handling:

- Pre-allocated permission and group slots with automatic position management
- Bitwise storage of group memberships and permissions using MongoDB Binary fields
- Cascading permission updates when group memberships change
- MongoDB FindCursor-based queries (compatible with Node.js streams)
- A CLI tool for database initialization
- Dual ESM and CommonJS builds

## Installation

```bash
npm install @icazemier/gibbons-mongodb mongodb
```

`mongodb` is a peer dependency -- you must install it alongside this library.

## Concepts

### How it works

Instead of join tables or arrays, gibbons-mongodb stores group memberships and permissions as bitwise masks (buffers). Each group and permission occupies a numbered "position" (1-based). A user's group membership is a single binary field where bit N means "member of group N". Similarly for permissions.

The database is pre-populated with a fixed number of group and permission "slots" (determined by byte length in config). Slots are **allocated** when you create a group/permission and **deallocated** when you remove them.

### Entities

- **Permissions**: Named capabilities (e.g., "can-edit", "admin"). Pre-allocated slots.
- **Groups**: Collections of permissions (e.g., "editors", "admins"). Pre-allocated slots with a bitwise permissions mask.
- **Users**: Documents with a `groupsGibbon` (group membership mask) and `permissionsGibbon` (aggregated permissions mask).

## Quick Start

### 1. Configuration

Create a `.gibbons-mongodbrc.json` in your project root:

```json
{
  "permissionByteLength": 128,
  "groupByteLength": 128,
  "mongoDbMutationConcurrency": 50,
  "dbStructure": {
    "user": {
      "dbName": "myapp",
      "collectionName": "users"
    },
    "group": {
      "dbName": "myapp",
      "collectionName": "groups"
    },
    "permission": {
      "dbName": "myapp",
      "collectionName": "permissions"
    }
  }
}
```

This gives you up to 1024 permissions (128 * 8) and 1024 groups.

### 2. Initialize the database

```bash
npx gibbons-mongodb init --uri=mongodb://localhost:27017
```

Or programmatically:

```typescript
import { MongoClient } from "mongodb";
import { MongoDbSeeder, ConfigLoader } from "@icazemier/gibbons-mongodb";

const config = await ConfigLoader.load();
const mongoClient = await MongoClient.connect("mongodb://localhost:27017");
const seeder = new MongoDbSeeder(mongoClient, config);
await seeder.initialize();
```

### 3. Use the library

```typescript
import { GibbonsMongoDb, ConfigLoader } from "@icazemier/gibbons-mongodb";

const config = await ConfigLoader.load();
const gibbons = new GibbonsMongoDb("mongodb://localhost:27017", config);
await gibbons.initialize();

// Allocate permissions
const canRead = await gibbons.allocatePermission({ name: "can-read" });
const canWrite = await gibbons.allocatePermission({ name: "can-write" });
const canDelete = await gibbons.allocatePermission({ name: "can-delete" });

// Allocate a group
const editors = await gibbons.allocateGroup({ name: "editors" });

// Subscribe permissions to the group
await gibbons.subscribePermissionsToGroups(
  [editors.gibbonGroupPosition],
  [canRead.gibbonPermissionPosition, canWrite.gibbonPermissionPosition]
);

// Create a user
const user = await gibbons.createUser({
  name: "Alice",
  email: "alice@example.com",
});

// Subscribe user to the group
await gibbons.subscribeUsersToGroups({ email: "alice@example.com" }, [
  editors.gibbonGroupPosition,
]);

// Validate permissions
const alice = await gibbons.findUsers({ email: "alice@example.com" }).next();
const hasReadWrite = gibbons.validateUserPermissionsForAllPermissions(
  alice.permissionsGibbon,
  [canRead.gibbonPermissionPosition, canWrite.gibbonPermissionPosition]
);
console.log(hasReadWrite); // true

const hasDelete = gibbons.validateUserPermissionsForAnyPermissions(
  alice.permissionsGibbon,
  [canDelete.gibbonPermissionPosition]
);
console.log(hasDelete); // false
```

## API Reference

All public methods are on the `GibbonsMongoDb` class. Position arguments accept `GibbonLike` which is `Gibbon | Array<number> | Buffer`.

### Permissions

| Method | Returns | Description |
|--------|---------|-------------|
| `allocatePermission(data)` | `Promise<IGibbonPermission>` | Allocate next available permission slot with custom data |
| `deallocatePermissions(positions)` | `Promise<void>` | Deallocate permissions and cascade-remove from groups and users |
| `findPermissions(positions)` | `FindCursor<IGibbonPermission>` | Find permission documents by positions |
| `findAllAllocatedPermissions()` | `FindCursor<IGibbonPermission>` | List all allocated permissions |
| `updatePermissionMetadata(position, data)` | `Promise<IGibbonPermission \| null>` | Update custom fields on a permission |
| `validateAllocatedPermissions(positions, allocated?)` | `Promise<boolean>` | Check if positions are allocated |

### Groups

| Method | Returns | Description |
|--------|---------|-------------|
| `allocateGroup(data)` | `Promise<IGibbonGroup>` | Allocate next available group slot with custom data |
| `deallocateGroups(positions)` | `Promise<void>` | Deallocate groups and remove membership from users |
| `findGroups(positions)` | `FindCursor<IGibbonGroup>` | Find group documents by positions |
| `findGroupsByPermissions(permissions, allocated?)` | `FindCursor` | Find groups that have specific permissions |
| `findAllAllocatedGroups()` | `FindCursor<IGibbonGroup>` | List all allocated groups |
| `updateGroupMetadata(position, data)` | `Promise<IGibbonGroup \| null>` | Update custom fields on a group |
| `subscribePermissionsToGroups(groups, permissions)` | `Promise<void>` | Add permissions to groups (cascades to users) |
| `unsubscribePermissionsFromGroups(groups, permissions)` | `Promise<void>` | Remove permissions from groups (recalculates users) |
| `validateAllocatedGroups(positions, allocated?)` | `Promise<boolean>` | Check if positions are allocated |

### Users

| Method | Returns | Description |
|--------|---------|-------------|
| `createUser(data)` | `Promise<IGibbonUser>` | Create a new user with empty group/permission gibbons |
| `removeUser(filter)` | `Promise<number>` | Remove users matching MongoDB filter |
| `findUsers(filter)` | `FindCursor<IGibbonUser>` | Find users by arbitrary MongoDB filter |
| `findUsersByGroups(groups)` | `FindCursor` | Find users subscribed to specific groups |
| `findUsersByPermissions(permissions)` | `FindCursor` | Find users with specific permissions |
| `updateUserMetadata(filter, data)` | `Promise<IGibbonUser \| null>` | Update custom fields on a user |
| `subscribeUsersToGroups(filter, groups)` | `Promise<void>` | Subscribe users to groups (adds permissions) |
| `unsubscribeUsersFromGroups(filter, groups)` | `Promise<void>` | Unsubscribe users from groups (recalculates permissions) |

### Validation (synchronous, in-memory)

| Method | Returns | Description |
|--------|---------|-------------|
| `validateUserGroupsForAllGroups(userGroups, groups)` | `boolean` | Check user has ALL specified groups |
| `validateUserGroupsForAnyGroups(userGroups, groups)` | `boolean` | Check user has ANY of specified groups |
| `validateUserPermissionsForAllPermissions(userPerms, perms)` | `boolean` | Check user has ALL specified permissions |
| `validateUserPermissionsForAnyPermissions(userPerms, perms)` | `boolean` | Check user has ANY of specified permissions |
| `getPermissionsGibbonForGroups(groups)` | `Promise<Gibbon>` | Get aggregated permissions Gibbon for given groups |

## Streaming

All `find*` methods return MongoDB `FindCursor` which supports Node.js streams:

```typescript
import { pipeline } from "stream";

const readable = gibbons.findUsersByGroups([1, 2]).stream();
pipeline(readable, myTransform, myWritable, (err) => {
  if (err) console.error(err);
});
```

## CLI

```bash
# Initialize database with pre-populated group and permission slots
npx gibbons-mongodb init --uri=mongodb://localhost:27017

# Use a custom config file
npx gibbons-mongodb init --uri=mongodb://localhost:27017 --config=./my-config.json
```

## Configuration

Configuration is loaded via [cosmiconfig](https://github.com/davidtheclark/cosmiconfig). It searches for:

- `.gibbons-mongodbrc.json`
- `.gibbons-mongodbrc.yaml`
- `gibbons-mongodb.config.js`
- `"gibbons-mongodb"` key in `package.json`

### Config Interface

```typescript
interface Config {
  permissionByteLength: number; // Max permissions = byteLength * 8
  groupByteLength: number; // Max groups = byteLength * 8
  mongoDbMutationConcurrency: number;
  dbStructure: {
    user: { dbName: string; collectionName: string };
    group: { dbName: string; collectionName: string };
    permission: { dbName: string; collectionName: string };
  };
}
```

## License

MIT
