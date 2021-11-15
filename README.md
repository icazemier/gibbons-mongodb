<img src="https://raw.githubusercontent.com/icazemier/gibbons/master/gibbons.png" width="200" />

# Gibbons for MongoDB

A set of functions to manage user-groups and user-permissions in [MongoDB](https://www.mongodb.com/) using [Gibbons](https://github.com/icazemier/gibbons)

For example:

-   ...

It makes use of the Binary class (data type) in MongoDB and can be queried accordingly.

Example implementation to get an idea:

```typescript
import { Gibbon } from "@icazemier/gibbons";

// mongoClient creation omitted (out of scope for the example)

const gibbon = Gibbon.create(1024).setPosition(1).setPosition(3);
const cursor = mongoClient
    .db("...")
    .collection("user")
    .find({
        groupsGibbon: {
            $bitsAnySet: gibbon.encode(),
        },
    });
```

What this is not / does not:

-   An ORM
-   ...

# Config

NOTE: Configs made have impact on how we store data, be mindfull when you change some config setting on a live system!

## Gibbons encoding/decoding

Depending on this environment variable: [GIBBONS_ENCODE_FROM_TO_STRING](https://github.com/icazemier/gibbons/blob/master/src/gibbon.ts#L444) Gibbons stores as UTF-16 encoded string or a [`Buffer` (wrapped in a `Binary`)](https://mongodb.github.io/node-mongodb-native/api-bson-generated/binary.html).

## Config file

We need to hook up this module with you MongoDB.

It expects at least 3 collections where the user collection can be an existing one.
This means, if you've got an existing user collection, likely you can just point this config to your existing user collection without breaking it (do make backups to be sure...).

For the other 2 collections (`group` and `permission`), you can configure the settings. But important to note is these collections are tailor made for use with Gibbons.

For the config to load, we depend on: [cosmiconfig](https://github.com/davidtheclark/cosmiconfig#readme)

Example config (file: `.gibbons-mongodbrc.json`)

```jsonc
{
    // The amount of bytes Gibbons allocates when initialized
    // Be sure to set this to a considerable amount
    "permissionByteLength": 1024, // which means 1024 * 8 = 8192 possible permissions
    "groupByteLength": 1024, // which means 1024 * 8 = 8192 possible groups
    "mongoDbMutationConcurrency": 5,
    "dbStructure": {
        "user": {
            "dbName": "test",
            "collection": "user",
            "fields": {
                // gibbon field which stores gibbon bytes pointing to different groups
                "groupsGibbon": "groupsGibbon",
                // permissions (aggregated from group memberships)
                "permissionsGibbon": "permissionsGibbon"
            }
        },
        "group": {
            "dbName": "test",
            "collection": "group",
            "fields": {
                // gibbon field which stores gibbon bytes pointing to different permissions
                "permissionsGibbon": "permissionsGibbon",
                // And auto incremented indexed field, which acks as foreign key for user=>gibbon bytes
                "gibbonGroupPosition": "gibbonGroupPosition",
                // If is in use or can be allocated when needed
                "gibbonIsAllocated": "gibbonIsAllocated"
            }
        },
        "permission": {
            "dbName": "test",
            "collection": "permission",
            "fields": {
                // And auto incremented indexed field, which acks as foreign key for user=>gibbon bytes
                "gibbonPermissionPosition": "gibbonPermissionPosition",
                // If is in use or can be allocated when needed
                "gibbonIsAllocated": "gibbonIsAllocated"
            }
        }
    }
}
```
