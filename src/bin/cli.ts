#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { init } from './init.js';

/**
 * Handles all incoming cli command and delegates them
 * @param argv
 */
const main = async (argv: {
    [x: string]: unknown;
    uri: string | undefined;
    config: string | undefined;
    _: (string | number)[];
    $0: string;
}) => {
    const [command] = argv._;

    switch (command) {
        case 'init':
            await init(argv);
            break;
        default:
            throw new Error(`Unhandled: ${command}`);
    }
};

const argv = yargs(hideBin(process.argv))
    .scriptName('gibbons-mongodb')
    .command(
        'init',
        'Populate new groups and permissions collections in your existing MongoDB instance'
    )
    .usage('Usage: $0 <command> [options]')
    .example(
        '$0 --uri=mongodb://localhost:27017 --config=./someconfig.json',
        'Populates groups and permissions in MongoDB for given URI specified by a custom config file'
    )
    .demandCommand(1, 'Expected a command, e.g. `init`')
    .options({
        uri: {
            demandOption: true,
            alias: 'u',
            type: 'string',
            description:
                'MongoDB URI (Note: Database name and collections are configured through config)',
            nargs: 1,
        },
        config: {
            demandOption: false,
            alias: 'c',
            type: 'string',
            description: 'Point to custom/own config file',
            nargs: 1,
        },
    })
    .describe('version', 'Show version number.')
    .parseSync();

main(argv)
    .then()
    .catch((error) => console.error(error))
    .finally(() => process.exit());
