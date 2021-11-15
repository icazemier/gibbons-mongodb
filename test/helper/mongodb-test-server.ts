import { MongoMemoryReplSet } from "mongodb-memory-server";

export class MongoDbTestServer {
    private static replSet: MongoMemoryReplSet;

    static get uri(): string {
        return MongoDbTestServer.replSet.getUri();
    }

    static async tearDownMongoMemoryCluster(): Promise<void> {
        await MongoDbTestServer.replSet.stop();
    }

    static async setupMongoMemoryCluster(): Promise<void> {
        const dbName = "test";

        console.info(`Setting up mongodb in memory replicaset`);
        const replicaSetName = "testset";
        MongoDbTestServer.replSet = await MongoMemoryReplSet.create({
            binary: {
                downloadDir: "node_modules/.cache/mongodb-binaries",
                checkMD5: true,
            },
            replSet: {
                dbName,
                name: replicaSetName,
                count: 2,
                storageEngine: "wiredTiger",
            },
        });

        await MongoDbTestServer.replSet.waitUntilRunning();
        await new Promise((resolve) => setTimeout(resolve, 4000));
    }
}
