export class Utils {

    /**
     * Generates a sequence 1 - n (amount) to use as async generator
     * @param {number} amount
     * @returns {number}
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