import { config } from 'dotenv';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

config();

let replSet: MongoMemoryReplSet;

export async function setup() {
  console.info('Setting up mongodb in memory replicaset');

  replSet = await MongoMemoryReplSet.create({
    binary: {
      downloadDir: 'node_modules/.cache/mongodb-binaries',
      checkMD5: true,
    },
    replSet: {
      dbName: 'test',
      name: 'testset',
      count: 2,
      storageEngine: 'wiredTiger',
    },
  });

  await replSet.waitUntilRunning();
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // Make URI available to test files via environment variable
  process.env.MONGO_URI = replSet.getUri();
}

export async function teardown() {
  if (replSet) {
    await replSet.stop();
  }
}
