import { MongoClient } from 'mongodb';
import { ConfigLoader } from '../config.js';
import { MongoDbSeeder } from '../seeder.js';

export const init = async (argv: {
    [x: string]: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    uri: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    _?: (string | number)[];
    $0?: string;
}) => {
    const { uri, config: configFile } = argv;

    const mongoClient = await new MongoClient(uri).connect();
    const config = await ConfigLoader.load('gibbons-mongodb', configFile);
    const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
    await mongoDbSeeder.initialise();
    await mongoClient.close();
};
