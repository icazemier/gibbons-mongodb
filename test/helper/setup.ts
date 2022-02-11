import { config } from 'dotenv';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { MongoDbTestServer } from './mongodb-memory-server.js';

config();
chai.use(chaiAsPromised);

before(async () => {
    await MongoDbTestServer.setupMongoMemoryReplicaset();
});

after(async () => {
    await MongoDbTestServer.tearDownMongoMemoryReplicaset();
});
