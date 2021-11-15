import { expect } from "chai";
import { ConfigLoader } from "../src/config.js";

describe("Happy flows ", () => {
    it("Find users by a group name with positions", async () => {
        const config = await ConfigLoader.load("gibbons-mongodb-sample");

        expect(config).to.be.ok;

        expect(true).to.equal(true);
    });

    it("Find users by a group name with positions, load faulty config", async () => {
        const throwsError = async () =>
            ConfigLoader.load("gibbons-mongodb-sampleeeee");

        await expect(throwsError()).to.be.rejectedWith(
            "Could not load config, execute `npx gibbons-mongodb init`"
        );
    });
});
