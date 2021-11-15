import { cosmiconfig } from "cosmiconfig";
import { Config } from "./types.js";
export class ConfigLoader {
    static async load(module = "gibbons-mongodb"): Promise<Config> {
        const explorer = cosmiconfig(module);

        const search = await explorer.search();
        if (!search?.config) {
            throw new Error(
                "Could not load config, execute `npx gibbons-mongodb init`"
            );
        }
        const { config } = search;
        return { ...config };
    }
}
