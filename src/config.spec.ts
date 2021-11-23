import { expect } from "chai";
import { ConfigLoader } from "./config.js";

describe("Happy flows ", () => {
    it("Load sample config", async () => {
        const config = await ConfigLoader.load("gibbons-mongodb-sample");

        expect(config).to.be.ok;

        expect(true).to.equal(true);
    });

    it("Load faulty config", async () => {
        const throwsError = async () =>
            ConfigLoader.load("gibbons-mongodb-sampleeeee");

        await expect(throwsError()).to.be.rejectedWith(
            "Could not load config, execute `npx gibbons-mongodb init`"
        );
    });
});
