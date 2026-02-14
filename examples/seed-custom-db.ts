/**
 * Example: Programmatically seed a custom MongoDB database with gibbons-mongodb.
 *
 * Usage:
 *   npx tsx examples/seed-custom-db.ts
 *
 * Prerequisites:
 *   - A running MongoDB instance (default: mongodb://localhost:27017)
 */
import { MongoClient } from 'mongodb';
import { MongoDbSeeder, Config } from '../src/index.js';

async function main() {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017';

  // 1. Define config with a single dbName shared by all collections
  const config: Config = {
    dbName: 'my_custom_db',
    permissionByteLength: 128,
    groupByteLength: 128,
    mongoDbMutationConcurrency: 5,
    dbStructure: {
      user: { collectionName: 'users' },
      group: { collectionName: 'groups' },
      permission: { collectionName: 'permissions' },
    },
  };

  // 2. Connect to MongoDB
  const mongoClient = await MongoClient.connect(mongoUri);

  try {
    // 3. Create a seeder and populate groups + permissions
    const seeder = new MongoDbSeeder(mongoClient, config);
    await seeder.initialize();

    const totalGroups = config.groupByteLength * 8;
    const totalPermissions = config.permissionByteLength * 8;
    console.log(
      `Seeded ${totalGroups} groups and ${totalPermissions} permissions into "${config.dbName}".`
    );
  } finally {
    await mongoClient.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
