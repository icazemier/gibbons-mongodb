export class MongoDbTestServer {
  static get uri(): string {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error(
        'MONGO_URI not set. Ensure globalSetup (test/helper/setup.ts) is configured in vitest.'
      );
    }
    return uri;
  }
}
