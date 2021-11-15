import { config } from 'dotenv';
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { MongoDbTestServer } from "./mongodb-test-server.js";

config();
chai.use(chaiAsPromised);

before(async () => {
    await MongoDbTestServer.setupMongoMemoryCluster();
});

after(async () => {
    await MongoDbTestServer.tearDownMongoMemoryCluster();
});
