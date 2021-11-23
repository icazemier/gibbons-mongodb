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
  public static sequenceGenerator(amount: number) {
    return {
      from: 1,
      to: amount,

      [Symbol.asyncIterator]() {
        return {
          current: this.from,
          last: this.to,

          async next() {
            if (this.current <= this.last) {
              return { done: false, value: this.current++ };
            }
            return { done: true };
          },
        };
      },
    };
  }
}
