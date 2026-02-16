import { ClientSession, MongoClient } from 'mongodb';

/**
 * Runs a callback inside a MongoDB transaction using the convenient API.
 * Handles session lifecycle, commit, abort, and transient-error retries automatically.
 *
 * @param client - Connected MongoClient instance
 * @param fn - Async callback receiving the session; all DB operations inside should pass `{ session }`
 * @returns The value returned by `fn`
 */
export async function withTransaction<T>(
  client: MongoClient,
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async (s) => {
      result = await fn(s);
    });
    return result;
  } finally {
    try {
      await session.endSession();
    } catch {
      // Swallow endSession errors so they don't mask the original error
    }
  }
}

export class Utils {
  /**
   * Generates a sequence 1 - n (amount) to use as async generator
   *
   * @param {number} amount - The number of items to generate in the sequence
   * @returns An async iterable that yields numbers from 1 to amount
   *
   * @example
   * ```typescript
   * // Generate sequence from 1 to 5
   * for await (const num of Utils.sequenceGenerator(5)) {
   *   console.log(num); // Prints: 1, 2, 3, 4, 5
   * }
   * ```
   */
  public static async *sequenceGenerator(
    amount: number
  ): AsyncGenerator<number> {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('amount must be a non-negative integer');
    }
    for (let i = 1; i <= amount; i++) {
      yield i;
    }
  }
}
