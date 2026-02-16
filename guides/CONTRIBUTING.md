# Contributing to gibbons-mongodb

## Prerequisites

- Node.js >= 22
- npm

## Setup

```bash
git clone https://github.com/icazemier/gibbons-mongodb.git
cd gibbons-mongodb
npm ci
```

## Development

### Running tests

```bash
npm test
```

Tests use [mongodb-memory-server](https://github.com/nodkz/mongodb-memory-server) which automatically downloads a MongoDB binary on first run. This may take a moment.

### Building

```bash
npm run build
```

Produces both ESM (`build/esm/`) and CJS (`build/cjs/`) outputs.

### Linting

```bash
npm run lint
npm run lint:fix  # auto-fix
```

## Project structure

```
src/
  gibbons-mongo-db.ts     Main facade class (public API)
  models/                 MongoDB model classes
    gibbon-model.ts       Abstract base class
    gibbon-user.ts        User model
    gibbon-group.ts       Group model
    gibbon-permission.ts  Permission model
  interfaces/             TypeScript interfaces
  seeder.ts               Database initialization
  config.ts               Configuration loading
  bin/                    CLI entry point
test/
  helper/                 Test infrastructure
  interfaces/             Test-specific interfaces
```

## Making changes

1. Create a feature branch from `development`
2. Make your changes
3. Ensure tests pass: `npm test`
4. Ensure build succeeds: `npm run build`
5. Ensure lint passes: `npm run lint`
6. Submit a pull request to `development`

## Code style

- TypeScript strict mode
- ESLint with Prettier
- Double quotes (enforced by eslint config)
- JSDoc comments on all public methods
- Tests co-located with source as `*.spec.ts` files

## Commit messages

Use [conventional commits](https://www.conventionalcommits.org/):

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `test:` test changes
- `chore:` maintenance
