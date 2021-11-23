<img src="https://raw.githubusercontent.com/icazemier/gibbons/master/gibbons.png" width="200" />

# Gibbons for MongoDB

A high-performance library to manage user groups and user permissions in [MongoDB](https://www.mongodb.com/) using bitwise operations with [Gibbons](https://github.com/icazemier/gibbons).

## Features

-   ⚡ **Bitwise efficiency** - Store and query thousands of permissions/groups using minimal space
-   🔍 **Fast queries** - Leverage MongoDB's bitwise operators for lightning-fast permission checks
-   🎯 **Type-safe** - Full TypeScript support with comprehensive type definitions
-   📦 **Easy setup** - CLI tool for database initialization
-   🔄 **Flexible** - Works with existing user collections

## What this is NOT

-   An ORM (Object-Relational Mapper)
-   A complete auth/authentication solution
-   A replacement for your existing user management system

## Quick Example

```typescript
import { GibbonsMongoDb, ConfigLoader } from "@icazemier/gibbons-mongodb";

// Initialize
const config = await ConfigLoader.load();
const gibbonsDb = new GibbonsMongoDb("mongodb://localhost:27017", config);
await gibbonsDb.initialize();

// Allocate permissions
const editPerm = await gibbonsDb.allocatePermission({ name: "posts.edit" });
const deletePerm = await gibbonsDb.allocatePermission({ name: "posts.delete" });

// Create a group with permissions
const adminGroup = await gibbonsDb.allocateGroup({ name: "Admins" });
await gibbonsDb.subscribePermissionsToGroups(
    [adminGroup.gibbonGroupPosition],
    [editPerm.gibbonPermissionPosition, deletePerm.gibbonPermissionPosition]
);

// Create user and assign to group
const user = await gibbonsDb.createUser({
    name: "John",
    email: "john@example.com"
});
await gibbonsDb.subscribeUsersToGroups(
    { _id: user._id },
    [adminGroup.gibbonGroupPosition]
);

// Validate permissions
const hasEdit = gibbonsDb.validateUserPermissionsForAnyPermissions(
    user.permissionsGibbon,
    [editPerm.gibbonPermissionPosition]
);
console.log("User can edit:", hasEdit); // true
```

## How It Works

Gibbons uses MongoDB's `Binary` data type to store bitwise masks. Each bit represents a group or permission position, allowing you to:

-   Store thousands of permissions in a few bytes
-   Use MongoDB's `$bitsAnySet`, `$bitsAllSet` operators for fast queries
-   Aggregate permissions from multiple groups automatically

Example MongoDB query:

```typescript
import { Gibbon } from "@icazemier/gibbons";

const gibbon = Gibbon.create(256).setPosition(1).setPosition(3);
const cursor = mongoClient
    .db("mydb")
    .collection("users")
    .find({
        groupsGibbon: {
            $bitsAnySet: gibbon.toBuffer(),
        },
    });
```

# Installation

```bash
npm install @icazemier/gibbons-mongodb
```

# Setup

## 1. Configuration File

Create a configuration file that Gibbons can discover. We use [cosmiconfig](https://github.com/davidtheclark/cosmiconfig#readme), so you can use any of these formats:

-   `.gibbons-mongodbrc.json` (recommended)
-   `.gibbons-mongodbrc.yaml`
-   `gibbons-mongodb` property in `package.json`
-   And more (see cosmiconfig docs)

### Configuration Structure

**⚠️ IMPORTANT:** Config settings affect how data is stored. Changing these on a live system can break existing data!

Example `.gibbons-mongodbrc.json`:

```json
{
    "permissionByteLength": 256,
    "groupByteLength": 256,
    "mongoDbMutationConcurrency": 10,
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

### Configuration Options

| Option                        | Type   | Description                                                                 |
| ----------------------------- | ------ | --------------------------------------------------------------------------- |
| `permissionByteLength`        | number | Bytes for permission Gibbon (e.g., 256 = 2,048 possible permissions)       |
| `groupByteLength`             | number | Bytes for group Gibbon (e.g., 256 = 2,048 possible groups)                 |
| `mongoDbMutationConcurrency`  | number | Concurrency limit for bulk operations                                       |
| `dbStructure.user`            | object | User collection config - can point to existing collection                  |
| `dbStructure.group`           | object | Group collection config - will be created/managed by Gibbons               |
| `dbStructure.permission`      | object | Permission collection config - will be created/managed by Gibbons          |

**Note:** The user collection can be an existing one. Gibbons adds `groupsGibbon` and `permissionsGibbon` fields without affecting other fields.

## 2. Initialize Database

Run the CLI tool to populate groups and permissions collections:

```bash
# Using default config
npx gibbons-mongodb init --uri mongodb://localhost:27017

# Using custom config file
npx gibbons-mongodb init --uri mongodb://localhost:27017 --config ./my-config.json

# Or use the alias
npx @icazemier/gibbons-mongodb init -u mongodb://localhost:27017
```

This creates:
-   `permissionByteLength * 8` non-allocated permission slots
-   `groupByteLength * 8` non-allocated group slots

For 256 bytes each, that's **2,048 groups** and **2,048 permissions** ready to allocate!

# Usage

## Initialize the Library

```typescript
import { GibbonsMongoDb, ConfigLoader } from "@icazemier/gibbons-mongodb";

// Load config (searches for .gibbons-mongodbrc files)
const config = await ConfigLoader.load();

// Or load from specific file
const config = await ConfigLoader.load("gibbons-mongodb", "./custom-config.json");

// Create instance
const gibbonsDb = new GibbonsMongoDb("mongodb://localhost:27017", config);

// Initialize (connects to MongoDB and sets up collections)
await gibbonsDb.initialize();
```

## Managing Permissions

```typescript
// Allocate new permissions
const createPost = await gibbonsDb.allocatePermission({
    name: "posts.create",
    description: "Create new blog posts",
});

const editPost = await gibbonsDb.allocatePermission({
    name: "posts.edit",
    description: "Edit any blog post",
});

const deletePost = await gibbonsDb.allocatePermission({
    name: "posts.delete",
    description: "Delete any blog post",
});

console.log(createPost.gibbonPermissionPosition); // e.g., 1
console.log(createPost.gibbonIsAllocated); // true

// Update permission metadata
await gibbonsDb.updatePermissionMetadata(createPost.gibbonPermissionPosition, {
    description: "Create and publish blog posts",
    module: "blog",
});

// List all allocated permissions
const permissionsCursor = gibbonsDb.findAllAllocatedPermissions();
for await (const perm of permissionsCursor) {
    console.log(perm.name, perm.gibbonPermissionPosition);
}

// Deallocate permissions (removes from groups and users)
await gibbonsDb.deallocatePermissions([deletePost.gibbonPermissionPosition]);
```

## Managing Groups

```typescript
// Allocate new groups
const admins = await gibbonsDb.allocateGroup({
    name: "Admins",
    description: "Full system access",
});

const editors = await gibbonsDb.allocateGroup({
    name: "Editors",
    description: "Content editors",
});

// Assign permissions to groups
await gibbonsDb.subscribePermissionsToGroups(
    [admins.gibbonGroupPosition],
    [createPost.gibbonPermissionPosition, editPost.gibbonPermissionPosition, deletePost.gibbonPermissionPosition]
);

await gibbonsDb.subscribePermissionsToGroups(
    [editors.gibbonGroupPosition],
    [createPost.gibbonPermissionPosition, editPost.gibbonPermissionPosition]
);

// Update group metadata
await gibbonsDb.updateGroupMetadata(admins.gibbonGroupPosition, {
    color: "#FF0000",
    priority: 1,
});

// Find groups by permissions
const groupsWithDelete = gibbonsDb.findGroupsByPermissions([deletePost.gibbonPermissionPosition]);
for await (const group of groupsWithDelete) {
    console.log(`${group.name} can delete posts`);
}

// Remove permissions from groups
await gibbonsDb.unsubscribePermissionsFromGroups(
    [editors.gibbonGroupPosition],
    [createPost.gibbonPermissionPosition]
);

// Deallocate groups (removes from users)
await gibbonsDb.deallocateGroups([editors.gibbonGroupPosition]);
```

## Managing Users

```typescript
// Create users
const user1 = await gibbonsDb.createUser({
    name: "Alice",
    email: "alice@example.com",
    username: "alice",
});

const user2 = await gibbonsDb.createUser({
    name: "Bob",
    email: "bob@example.com",
    username: "bob",
});

// Assign users to groups
await gibbonsDb.subscribeUsersToGroups(
    { email: "alice@example.com" },
    [admins.gibbonGroupPosition]
);

await gibbonsDb.subscribeUsersToGroups(
    { _id: user2._id },
    [editors.gibbonGroupPosition]
);

// Find users by groups
const adminUsers = gibbonsDb.findUsersByGroups([admins.gibbonGroupPosition]);
for await (const user of adminUsers) {
    console.log(`${user.name} is an admin`);
}

// Find users by permissions
const usersWhoCanEdit = gibbonsDb.findUsersByPermissions([editPost.gibbonPermissionPosition]);

// Find users with custom filter
const activeUsers = gibbonsDb.findUsers({
    status: "active",
    createdAt: { $gte: new Date("2024-01-01") },
});

// Remove users from groups
await gibbonsDb.unsubscribeUsersFromGroups(
    { email: "bob@example.com" },
    [editors.gibbonGroupPosition]
);

// Delete users
const deletedCount = await gibbonsDb.removeUser({ email: "bob@example.com" });
console.log(`Deleted ${deletedCount} user(s)`);
```

## Permission Validation

```typescript
// Fetch user with populated gibbons
const user = await gibbonsDb.findUsers({ email: "alice@example.com" }).next();

if (user) {
    // Check if user has ALL specified permissions
    const canEditAndDelete = gibbonsDb.validateUserPermissionsForAllPermissions(
        user.permissionsGibbon,
        [editPost.gibbonPermissionPosition, deletePost.gibbonPermissionPosition]
    );

    // Check if user has ANY of the specified permissions
    const canModify = gibbonsDb.validateUserPermissionsForAnyPermissions(
        user.permissionsGibbon,
        [editPost.gibbonPermissionPosition, deletePost.gibbonPermissionPosition]
    );

    // Check if user has ALL specified groups
    const isAdmin = gibbonsDb.validateUserGroupsForAllGroups(
        user.groupsGibbon,
        [admins.gibbonGroupPosition]
    );

    // Check if user has ANY of the specified groups
    const isStaff = gibbonsDb.validateUserGroupsForAnyGroups(
        user.groupsGibbon,
        [admins.gibbonGroupPosition, editors.gibbonGroupPosition]
    );

    console.log({
        canEditAndDelete,
        canModify,
        isAdmin,
        isStaff,
    });
}
```

## Database Validation

```typescript
// Verify groups are allocated before using them
const groupsValid = await gibbonsDb.validateAllocatedGroups([1, 2, 3]);
if (!groupsValid) {
    throw new Error("Some groups are not allocated");
}

// Verify permissions are allocated
const permsValid = await gibbonsDb.validateAllocatedPermissions([5, 6, 7]);
```

## Working with Gibbons Directly

```typescript
import { Gibbon } from "@icazemier/gibbons";

// Get aggregated permissions from groups
const permissionsGibbon = await gibbonsDb.getPermissionsGibbonForGroups([
    admins.gibbonGroupPosition,
    editors.gibbonGroupPosition,
]);

// Get positions as array
const positions = permissionsGibbon.getPositionsArray();
console.log("Permission positions:", positions); // e.g., [1, 2, 3, 5]

// Manual permission checks
const hasPermission = permissionsGibbon.isPositionSet(editPost.gibbonPermissionPosition);
```

# API Reference

For complete API documentation with examples, see the [TypeScript definitions](./src/index.ts) or check the TSDoc comments in your IDE.

## Main Classes

-   **`GibbonsMongoDb`** - Main class for managing users, groups, and permissions
-   **`MongoDbSeeder`** - Seeds database with pre-allocated groups and permissions
-   **`ConfigLoader`** - Loads configuration from filesystem

## Key Methods

### GibbonsMongoDb

#### Permissions
-   `allocatePermission<T>(data: T)` - Allocate new permission
-   `deallocatePermissions(permissions)` - Deallocate permissions
-   `updatePermissionMetadata(position, data)` - Update permission metadata
-   `findAllAllocatedPermissions()` - List all allocated permissions
-   `validateAllocatedPermissions(permissions)` - Validate permissions exist

#### Groups
-   `allocateGroup<T>(data: T)` - Allocate new group
-   `deallocateGroups(groups)` - Deallocate groups
-   `updateGroupMetadata(position, data)` - Update group metadata
-   `findGroups(groups)` - Find specific groups
-   `findGroupsByPermissions(permissions)` - Find groups with permissions
-   `findAllAllocatedGroups()` - List all allocated groups
-   `validateAllocatedGroups(groups)` - Validate groups exist

#### Users
-   `createUser<T>(data: T)` - Create new user
-   `removeUser(filter)` - Delete users
-   `findUsers(filter)` - Query users
-   `findUsersByGroups(groups)` - Find users by groups
-   `findUsersByPermissions(permissions)` - Find users by permissions

#### Subscriptions
-   `subscribeUsersToGroups(filter, groups)` - Add users to groups
-   `subscribePermissionsToGroups(groups, permissions)` - Add permissions to groups
-   `unsubscribeUsersFromGroups(filter, groups)` - Remove users from groups
-   `unsubscribePermissionsFromGroups(groups, permissions)` - Remove permissions from groups

#### Validation
-   `validateUserGroupsForAllGroups(userGroups, groups)` - Check if user has all groups
-   `validateUserGroupsForAnyGroups(userGroups, groups)` - Check if user has any group
-   `validateUserPermissionsForAllPermissions(userPerms, perms)` - Check if user has all permissions
-   `validateUserPermissionsForAnyPermissions(userPerms, perms)` - Check if user has any permission

# Advanced Topics

## Data Structure

### User Document
```typescript
{
    _id: ObjectId,
    // Your custom fields
    name: "Alice",
    email: "alice@example.com",
    // Gibbons-managed fields
    groupsGibbon: Binary,        // Bitwise mask of group memberships
    permissionsGibbon: Binary,   // Aggregated permissions from groups
}
```

### Group Document
```typescript
{
    _id: ObjectId,
    gibbonGroupPosition: 1,      // Unique position (1-based)
    gibbonIsAllocated: true,     // Allocation status
    permissionsGibbon: Binary,   // Bitwise mask of permissions
    // Your custom fields
    name: "Admins",
    description: "Full access",
}
```

### Permission Document
```typescript
{
    _id: ObjectId,
    gibbonPermissionPosition: 5, // Unique position (1-based)
    gibbonIsAllocated: true,     // Allocation status
    // Your custom fields
    name: "posts.edit",
    description: "Edit posts",
}
```

## MongoDB Queries

You can query directly using MongoDB's bitwise operators:

```typescript
import { Binary } from "mongodb";
import { Gibbon } from "@icazemier/gibbons";

// Find users with specific permissions
const gibbon = Gibbon.create(256)
    .setPosition(editPost.gibbonPermissionPosition)
    .setPosition(deletePost.gibbonPermissionPosition);

const users = await db.collection("users").find({
    permissionsGibbon: {
        $bitsAllSet: new Binary(gibbon.toBuffer()),
    },
}).toArray();
```

## Environment Variables

-   `GIBBONS_ENCODE_FROM_TO_STRING` - Controls whether Gibbons encodes to UTF-16 string or Buffer (see [Gibbons docs](https://github.com/icazemier/gibbons))

# Best Practices

1. **Choose appropriate byte lengths** - Calculate based on your maximum expected permissions/groups:
   -   256 bytes = 2,048 items
   -   512 bytes = 4,096 items
   -   1024 bytes = 8,192 items

2. **Don't change byte lengths on live systems** - This will corrupt existing data

3. **Use meaningful names** - Store descriptive names/descriptions with permissions and groups for easier management

4. **Aggregate permissions through groups** - Don't assign permissions directly to users; use groups for better maintainability

5. **Validate before operations** - Always check if groups/permissions are allocated before using them

6. **Monitor allocation usage** - Keep track of how many slots you've used vs. available

7. **Backup before migrations** - Config changes can affect data structure

# Troubleshooting

## "Could not load config"
Make sure you have a `.gibbons-mongodbrc.json` (or equivalent) in your project root or run `npx gibbons-mongodb init` with `--config` flag.

## "Not able to allocate permission/group"
All slots are used. Increase `permissionByteLength` or `groupByteLength` in config, reinitialize database.

## "Called populateGroupsAndPermissions, but permissions and groups seem to be populated already"
Database is already initialized. This is expected on subsequent runs.

# License

MIT

# Contributing

Issues and pull requests welcome! See [repository](https://github.com/icazemier/gibbons-mongodb) for details.

## For Contributors

This project uses automated semantic versioning. Please use conventional commits:

```bash
npm run commit  # Interactive commit tool
```

See [SEMANTIC-VERSIONING-QUICKSTART.md](SEMANTIC-VERSIONING-QUICKSTART.md) for details.
