import { MongoClient } from 'mongodb';
import { ConfigLoader } from '../config.js';
import { MongoDbSeeder } from '../seeder.js';

/**
 * Command arguments for the init command.
 */
export interface InitCommandArgs {
  /** MongoDB connection URI */
  uri: string;
  /** Optional path to custom configuration file */
  config?: string;
}

/**
 * Initializes a MongoDB instance with pre-populated groups and permissions.
 * Connects to the database, loads configuration, and runs the seeding process.
 *
 * @param argv - Command-line arguments containing URI and optional config path
 * @throws Error when configuration cannot be loaded or seeding fails
 */
export const init = async (argv: InitCommandArgs): Promise<void> => {
  const { uri, config: configFile } = argv;
  let mongoClient: MongoClient | null = null;

  try {
    mongoClient = await new MongoClient(uri).connect();
    const config = await ConfigLoader.load('gibbons-mongodb', configFile);
    const mongoDbSeeder = new MongoDbSeeder(mongoClient, config);
    await mongoDbSeeder.initialize();
  } finally {
    if (mongoClient) {
      await mongoClient.close();
    }
  }
};
