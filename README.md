<img src="https://raw.githubusercontent.com/icazemier/gibbons/master/gibbons.png" width="200" />

# Gibbons for MongoDB

Manage user groups and permissions in [MongoDB](https://www.mongodb.com/) using bitwise operations with [Gibbons](https://github.com/icazemier/gibbons). Store and query thousands of permissions using minimal space.

## Install

```bash
npm install @icazemier/gibbons-mongodb
```

## Quick Start

### 1. Create a config file

`.gibbons-mongodbrc.json` in your project root:

```json
{
    "dbName": "myapp",
    "permissionByteLength": 256,
    "groupByteLength": 256,
    "mongoDbMutationConcurrency": 10,
    "dbStructure": {
        "user": { "collectionName": "users" },
        "group": { "collectionName": "groups" },
        "permission": { "collectionName": "permissions" }
    }
}
```

### 2. Seed the database

```bash
npx gibbons-mongodb init --uri mongodb://localhost:27017
```

This creates pre-allocated permission and group slots. With 256 bytes you get 2,048 slots each.

### 3. Use it

```typescript
import { GibbonsMongoDb, ConfigLoader } from "@icazemier/gibbons-mongodb";

const config = await ConfigLoader.load();
const gibbonsDb = new GibbonsMongoDb("mongodb://localhost:27017", config);
await gibbonsDb.initialize();

// Create permissions
const editPerm = await gibbonsDb.allocatePermission({ name: "posts.edit" });
const deletePerm = await gibbonsDb.allocatePermission({ name: "posts.delete" });

// Create a group and assign permissions
const admins = await gibbonsDb.allocateGroup({ name: "Admins" });
await gibbonsDb.subscribePermissionsToGroups(
    [admins.gibbonGroupPosition],
    [editPerm.gibbonPermissionPosition, deletePerm.gibbonPermissionPosition]
);

// Create a user and assign to group
const user = await gibbonsDb.createUser({ name: "Alice", email: "alice@example.com" });
await gibbonsDb.subscribeUsersToGroups({ _id: user._id }, [admins.gibbonGroupPosition]);

// Check permissions
const canEdit = gibbonsDb.validateUserPermissionsForAnyPermissions(
    user.permissionsGibbon,
    [editPerm.gibbonPermissionPosition]
);
// canEdit === true
```

## Using Your Own MongoClient

You can inject an existing `MongoClient` instead of a URI. This lets you create sessions from your own client and pass them to any method for transactional control:

```typescript
import { MongoClient } from "mongodb";
import { GibbonsMongoDb, ConfigLoader, withTransaction } from "@icazemier/gibbons-mongodb";

const client = await MongoClient.connect("mongodb://localhost:27017");
const config = await ConfigLoader.load();

const gibbonsDb = new GibbonsMongoDb(client, config);
await gibbonsDb.initialize();

// Wrap multiple operations in a single transaction
await withTransaction(client, async (session) => {
    const perm = await gibbonsDb.allocatePermission({ name: "reports.view" }, session);
    const group = await gibbonsDb.allocateGroup({ name: "Viewers" }, session);
    await gibbonsDb.subscribePermissionsToGroups(
        [group.gibbonGroupPosition],
        [perm.gibbonPermissionPosition],
        session
    );
});
```

Every public method accepts an optional `session` parameter. When omitted, multi-step methods automatically use an internal transaction.

## API Overview

### Permissions

| Method | Description |
|--------|-------------|
| `allocatePermission(data, session?)` | Allocate a new permission slot |
| `deallocatePermissions(positions, session?)` | Deallocate and remove from groups/users |
| `updatePermissionMetadata(position, data, session?)` | Update custom fields |
| `findPermissions(positions)` | Find by positions |
| `findAllAllocatedPermissions()` | List all allocated |
| `validateAllocatedPermissions(positions)` | Check if allocated in DB |

### Groups

| Method | Description |
|--------|-------------|
| `allocateGroup(data, session?)` | Allocate a new group slot |
| `deallocateGroups(positions, session?)` | Deallocate and remove from users |
| `updateGroupMetadata(position, data, session?)` | Update custom fields |
| `subscribePermissionsToGroups(groups, perms, session?)` | Add permissions to groups |
| `unsubscribePermissionsFromGroups(groups, perms, session?)` | Remove permissions from groups |
| `findGroups(positions)` | Find by positions |
| `findGroupsByPermissions(positions)` | Find groups that have certain permissions |
| `findAllAllocatedGroups()` | List all allocated |
| `validateAllocatedGroups(positions)` | Check if allocated in DB |

### Users

| Method | Description |
|--------|-------------|
| `createUser(data, session?)` | Create with empty gibbons |
| `removeUser(filter, session?)` | Delete by filter |
| `subscribeUsersToGroups(filter, groups, session?)` | Add users to groups |
| `unsubscribeUsersFromGroups(filter, groups, session?)` | Remove users from groups |
| `findUsers(filter)` | Query by MongoDB filter |
| `findUsersByGroups(positions)` | Find by group membership |
| `findUsersByPermissions(positions)` | Find by permission |
| `updateUserMetadata(filter, data, session?)` | Update custom fields |

### Validation (synchronous, no DB call)

| Method | Description |
|--------|-------------|
| `validateUserPermissionsForAllPermissions(userPerms, perms)` | Has ALL permissions? |
| `validateUserPermissionsForAnyPermissions(userPerms, perms)` | Has ANY permission? |
| `validateUserGroupsForAllGroups(userGroups, groups)` | In ALL groups? |
| `validateUserGroupsForAnyGroups(userGroups, groups)` | In ANY group? |

### Utilities

| Method/Function | Description |
|--------|-------------|
| `getMongoClient()` | Get the underlying MongoClient |
| `getPermissionsGibbonForGroups(groups)` | Aggregate permissions from groups |
| `withTransaction(client, fn)` | Run a callback inside a MongoDB transaction |

## Config Options

| Option | Type | Description |
|--------|------|-------------|
| `dbName` | string | MongoDB database name |
| `permissionByteLength` | number | Bytes for permissions (256 = 2,048 slots) |
| `groupByteLength` | number | Bytes for groups (256 = 2,048 slots) |
| `mongoDbMutationConcurrency` | number | Concurrency limit for bulk operations |
| `dbStructure.user.collectionName` | string | User collection (can be existing) |
| `dbStructure.group.collectionName` | string | Group collection (managed by Gibbons) |
| `dbStructure.permission.collectionName` | string | Permission collection (managed by Gibbons) |

Config is loaded via [cosmiconfig](https://github.com/davidtheclark/cosmiconfig), so `.gibbons-mongodbrc.json`, `.yaml`, or a `gibbons-mongodb` key in `package.json` all work.

## FAQ

**What is this?**
A permissions library. It stores group memberships and permissions as compact bitmasks in MongoDB, using `$bitsAnySet` / `$bitsAllSet` for fast queries.

**What is this NOT?**
An ORM, an authentication solution, or a user management system. It only manages the group/permission layer.

**Can I use an existing user collection?**
Yes. Gibbons adds `groupsGibbon` and `permissionsGibbon` fields without touching your other fields.

**How many permissions/groups can I have?**
`byteLength * 8`. So 256 bytes = 2,048, 1024 bytes = 8,192.

**Can I change byte lengths later?**
Yes. Use `expandPermissions` / `expandGroups` to grow, or `shrinkPermissions` / `shrinkGroups` to reduce. These methods re-seed slots, pad or truncate existing Binary fields, and update the config — all inside a transaction.

**Do I need a replica set for transactions?**
Yes. MongoDB transactions require a replica set (or sharded cluster). Standalone servers don't support them, but you can still use all methods without the `session` parameter.

**Can I pass my own MongoClient?**
Yes. `new GibbonsMongoDb(myClient, config)` reuses your client, so sessions you create from it work with all facade methods.

**How do transactions work?**
Multi-step methods (deallocate, subscribe, unsubscribe) auto-wrap in a transaction when no `session` is passed. To combine multiple calls in one transaction, pass your own `session`.

**What happens when all slots are used?**
`allocatePermission` / `allocateGroup` throws. Use `expandPermissions` / `expandGroups` to increase capacity at runtime.

## License

MIT

## Contributing

Issues and PRs welcome at [github.com/icazemier/gibbons-mongodb](https://github.com/icazemier/gibbons-mongodb).

This project uses [conventional commits](https://www.conventionalcommits.org/) with automated semantic versioning. See [SEMANTIC-VERSIONING-QUICKSTART.md](SEMANTIC-VERSIONING-QUICKSTART.md) for details.
