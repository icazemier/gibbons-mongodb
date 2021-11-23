# Swarm Instructions: gibbons-mongodb Open Source Release

## Project Overview

**gibbons-mongodb** is a Node.js library for managing user groups and permissions with bitwise efficiency, backed by MongoDB. It uses the `@icazemier/gibbons` core library for bitwise operations and provides a MongoDB persistence layer with a facade (`GibbonsMongoDb`), models (`GibbonUser`, `GibbonGroup`, `GibbonPermission`), a database seeder (`MongoDbSeeder`), and a CLI tool.

### Architecture

```
src/
  gibbons-mongo-db.ts    # Main facade - all public API methods
  interfaces/            # TypeScript interfaces (Config, IGibbonUser, IGibbonGroup, IGibbonPermission, etc.)
  models/                # MongoDB model classes (GibbonModel base, GibbonUser, GibbonGroup, GibbonPermission)
  seeder.ts              # MongoDbSeeder - prepopulates groups/permissions collections
  config.ts              # ConfigLoader - cosmiconfig-based config loading
  utils.ts               # Utility helpers
  bin/                   # CLI (cli.ts + init.ts)
  index.ts               # Public exports
test/
  helper/                # Test infrastructure (setup.ts, fixtures.ts, seeders.ts, mongodb-memory-server.ts)
  interfaces/            # Test-specific interfaces (TestUser, TestGroup, TestPermission)
```

### Domain Model

- **Permissions** are pre-populated slots (position 1..N) that can be allocated with metadata and deallocated
- **Groups** are pre-populated slots with a bitwise permissions mask; can be allocated/deallocated
- **Users** are created/removed documents holding a `groupsGibbon` (group membership mask) and `permissionsGibbon` (aggregated permissions mask)
- All bitwise fields use the `Gibbon` class from `@icazemier/gibbons`, stored as `Binary` in MongoDB
- `GibbonLike` = `Gibbon | Array<number> | Buffer` — all public methods accept any of these

### Current Test Infrastructure

- **Framework**: Vitest with `mongodb-memory-server` (in-memory MongoDB replica set)
- **Config**: `vite.config.ts` with `globalSetup: './test/helper/setup.ts'`, `fileParallelism: false`, 30s test timeout, 120s hook timeout
- **Test files**: Co-located in `src/` as `*.spec.ts` (3 spec files: `gibbons-mongo-db.spec.ts`, `extremities.spec.ts`, `config.spec.ts`, `mongo-db-seeder.spec.ts`)
- **Commands**: `npm test` (vitest run --coverage), `npm run build`, `npm run lint`

---

## Milestone 1: Complete the API (Missing CRUD Methods)

### Task 1.1: Add `findPermissions(positions)` to facade and model

**Context**: Groups have `findGroups(positions)` but permissions have no equivalent. This breaks API symmetry.

**Model layer** (`src/models/gibbon-permission.ts`):

Add a `find` method to `GibbonPermission`:

```typescript
/**
 * Finds permission documents matching the given positions.
 */
public find(permissions: GibbonLike): FindCursor<IGibbonPermission> {
  const filter = {
    gibbonPermissionPosition: {
      $in: this.ensureGibbon(permissions).getPositionsArray(),
    },
  };
  return this.dbCollection.find(filter);
}
```

**Facade layer** (`src/gibbons-mongo-db.ts`):

```typescript
/**
 * Convenience function to retrieve permission documents by positions
 */
public findPermissions(permissions: GibbonLike): FindCursor<IGibbonPermission> {
  return this.gibbonPermission.find(permissions);
}
```

**Test** (`src/gibbons-mongo-db.spec.ts`): Add a test that allocates permissions, then retrieves them by position and asserts fields match.

### Task 1.2: Add `updateUserMetadata` to facade and model

**Context**: Groups and permissions both expose `updateMetadata(position, data)`. Users have no equivalent, so there's no way to update a user's custom fields (name, email) through the library.

**Model layer** (`src/models/gibbon-user.ts`):

```typescript
/**
 * Updates custom metadata on a user document.
 * Does not modify groupsGibbon or permissionsGibbon.
 */
public async updateMetadata<T extends Record<string, unknown>>(
  filter: Filter<IGibbonUser>,
  data: T
): Promise<IGibbonUser | null> {
  const options: FindOneAndUpdateOptions = { returnDocument: 'after' };
  const result = await this.dbCollection.findOneAndUpdate(
    filter,
    { $set: data as Partial<IGibbonUser> },
    options
  );
  return result ? GibbonUser.mapPermissionsBinaryToGibbon(result) : null;
}
```

**Facade layer** (`src/gibbons-mongo-db.ts`):

```typescript
/**
 * Update metadata on a user (e.g. name, email)
 * Does not modify groupsGibbon or permissionsGibbon
 */
public async updateUserMetadata<T extends Record<string, unknown>>(
  filter: Filter<IGibbonUser>,
  data: T
): Promise<IGibbonUser | null> {
  return this.gibbonUser.updateMetadata(filter, data);
}
```

**Test**: Create a user, update their name, verify the returned document and a fresh read both reflect the change.

### Task 1.3: Run full test suite, verify all pass

After implementing 1.1 and 1.2, run `npm test` and `npm run build` to verify nothing breaks.

---

## Milestone 2: Modernize CI/CD

### Task 2.1: Update `.github/workflows/ci.yml`

The current CI is severely outdated:
- Node 14/16/17 matrix (package.json requires `^16 || ^18 || >=20`)
- `actions/checkout@v2`, `actions/setup-node@v2`
- `MONGOMS_VERSION: 4.4.5`

Replace with:

```yaml
name: CI

on:
  push:
    branches: [development, 'feature/*']
  pull_request:
    branches: [development]

jobs:
  test:
    if: "!contains(github.event.head_commit.message, 'skip ci')"
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

### Task 2.2: Update `.github/workflows/npm-publish.yml`

Current issues:
- Triggers on `master` branch (should be `main` or a tag-based release)
- Uses `actions/checkout@v2`, `actions/setup-node@v1`
- Node 14/16/17 matrix
- Dual publish to GitHub Packages and npmjs (keep both but modernize)

Replace with modern actions (v4), Node 20, and trigger on GitHub releases (tags):

```yaml
name: Publish

on:
  release:
    types: [published]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test

  publish-npm:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
          scope: '@icazemier'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-github:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
          scope: '@icazemier'
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Milestone 3: Package Quality

### Task 3.1: Fix `peerDependencies`

`mongodb` is currently in `devDependencies` only. Consumers must install their own `mongodb` driver. Move it to `peerDependencies`:

```json
{
  "peerDependencies": {
    "mongodb": "^6.0.0"
  }
}
```

Consider whether `@icazemier/gibbons` should also be a peer dependency (consumers don't directly use it, so keeping it as a regular dependency is fine).

### Task 3.2: Update `.npmignore`

Current `.npmignore` references stale files (`.mocharc.json`, `.eslintrc.json`, `jsconfig.json`, `jsdocs.json`). Clean it up to match the actual project structure:

```
# Source and tests
src/
test/
coverage/

# Config files
.github/
.claude/
.vscode/
.nvmrc
.editorconfig
.prettierrc.json
eslint.config.js
tsconfig.json
tsconfig-build-*.json
vite.config.ts
fixup.mjs
CLAUDE.md

# Docs (shipped separately)
docs/

# Misc
**/*.spec.ts
*.svg
```

### Task 3.3: Validate `package.json` fields

Ensure these fields are correct:
- `version`: Set to `1.0.0` (or appropriate) before first publish
- `main`, `module`, `exports`, `types`: Already correct for dual CJS/ESM
- `files`: `["build/"]` — already correct
- `engines`: `"node": ">=18.0.0"` (drop Node 16 since it's EOL)
- `repository.url`: Verify it matches the actual GitHub repo
- Add `"homepage"` and `"bugs"` fields

### Task 3.4: Add `.nvmrc`

Create `.nvmrc` with `20` (or `lts/*`).

---

## Milestone 4: Documentation

### Task 4.1: Create `README.md`

Must include:
1. **Badge row**: CI status, npm version, license
2. **One-line description**: Bitwise user groups and permissions management for MongoDB
3. **Install**: `npm install @icazemier/gibbons-mongodb mongodb`
4. **Quick start**: Show `MongoDbSeeder.initialise()`, `GibbonsMongoDb` constructor + `initialize()`, then allocate a permission, allocate a group, subscribe permission to group, create user, subscribe user to group, validate permissions
5. **API reference**: Table of all public methods on `GibbonsMongoDb` grouped by entity (Users, Groups, Permissions, Validation)
6. **CLI usage**: `npx gibbons-mongodb init --uri=mongodb://...`
7. **Configuration**: Explain cosmiconfig and the `Config` interface
8. **License**: MIT

### Task 4.2: Create `CONTRIBUTING.md`

Include:
- Prerequisites (Node >= 18, npm)
- Setup (`npm ci`)
- Running tests (`npm test`) — explain mongodb-memory-server auto-downloads MongoDB binary
- Building (`npm run build`)
- Linting (`npm run lint`)
- Commit convention (conventional commits if using semantic-release)
- PR process

### Task 4.3: Create `CHANGELOG.md`

Start with current state as v1.0.0 (or next version). Document all public API methods.

---

## Milestone 5: Code Quality Polish

### Task 5.1: Fix inconsistent `initialise` / `initialize` spelling

`MongoDbSeeder` has `initialise()` which calls `populateGroupsAndPermissions()`. The rest of the codebase uses `initialize`. Add an `initialize` alias and deprecate `initialise`:

```typescript
/** @deprecated Use initialize() instead */
async initialise(): Promise<void> {
  return this.initialize();
}

async initialize(): Promise<void> {
  return this.populateGroupsAndPermissions();
}
```

Update the `init.ts` CLI to call `initialize()`.

### Task 5.2: Verify build output

Run `npm run build` and verify:
- `build/esm/` contains `.js`, `.d.ts`, `.js.map` files
- `build/cjs/` contains `.js`, `.d.ts`, `.js.map` files
- Entry points resolve correctly
- `fixup.mjs` creates proper `package.json` files in each directory

### Task 5.3: Run tests and ensure full coverage

Run `npm test` with coverage. Aim for > 90% line coverage on `src/` (excluding spec files). Identify any uncovered branches and add tests if straightforward.

---

## Swarm Topology: Hierarchical (6 agents)

```
                    ┌─────────────┐
                    │   LEADER    │
                    │ (You/Coord) │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
     ┌─────┴─────┐   ┌────┴────┐   ┌──────┴──────┐
     │  CODER-1  │   │ CODER-2 │   │   TESTER    │
     │ API gaps  │   │ CI/CD + │   │  Tests for  │
     │ + model   │   │ pkg.json│   │  new methods│
     └───────────┘   └─────────┘   └─────────────┘
     ┌─────┴─────┐   ┌────┴────┐
     │  DOCS     │   │ REVIEWER│
     │ README +  │   │ Quality │
     │ CONTRIB   │   │  check  │
     └───────────┘   └─────────┘
```

### Agent Assignments

| Agent | Type | Milestone | Tasks | Run In Background |
|-------|------|-----------|-------|-------------------|
| **coder-api** | `coder` | 1 | 1.1, 1.2 — Add missing CRUD methods to models + facade | Yes |
| **coder-infra** | `coder` | 2, 3 | 2.1, 2.2, 3.1–3.4 — CI/CD modernization, package.json fixes, .npmignore | Yes |
| **tester** | `tester` | 1.3, 5.3 | Write tests for new methods, run full suite, verify coverage | Yes (after coder-api) |
| **docs-writer** | `coder` | 4 | 4.1–4.3 — README.md, CONTRIBUTING.md, CHANGELOG.md | Yes |
| **reviewer** | `reviewer` | 5 | 5.1–5.2 — Code quality, spelling fixes, build verification | Yes |
| **leader** | (you) | All | Coordinate, review results, final integration | No |

### Execution Order

```
Phase 1 (parallel):
  - coder-api: Implement findPermissions + updateUserMetadata
  - coder-infra: Modernize CI/CD + package.json + .npmignore
  - docs-writer: Write README.md + CONTRIBUTING.md + CHANGELOG.md

Phase 2 (after Phase 1):
  - tester: Write + run tests for new methods, full coverage check
  - reviewer: Review all changes, fix spelling inconsistencies, verify build

Phase 3 (sequential):
  - leader: Review all results, run final `npm run build && npm test && npm run lint`
  - leader: Commit and optionally create PR
```

### Agent Prompts

#### coder-api

```
You are working on the gibbons-mongodb library. Your task is to add two missing CRUD methods.

TASK 1: Add `findPermissions(positions)`
- In `src/models/gibbon-permission.ts`, add a `find(permissions: GibbonLike)` method that queries
  `gibbonPermissionPosition: { $in: positions }` and returns a `FindCursor<IGibbonPermission>`.
  Follow the pattern of `GibbonGroup.find()` in `src/models/gibbon-group.ts`.
- In `src/gibbons-mongo-db.ts`, add `findPermissions(permissions: GibbonLike): FindCursor<IGibbonPermission>`
  that delegates to `this.gibbonPermission.find(permissions)`.
  Follow the pattern of `findGroups()`.

TASK 2: Add `updateUserMetadata(filter, data)`
- In `src/models/gibbon-user.ts`, add `updateMetadata<T extends Record<string, unknown>>(filter, data)`
  that uses `findOneAndUpdate` with `returnDocument: 'after'` and maps the result with
  `mapPermissionsBinaryToGibbon`. Follow the pattern of `GibbonGroup.updateMetadata()`.
- In `src/gibbons-mongo-db.ts`, add `updateUserMetadata<T>(filter, data)` that delegates to
  `this.gibbonUser.updateMetadata(filter, data)`.
  Follow the pattern of `updateGroupMetadata()`.

IMPORTANT:
- Read each file before editing
- Keep the same code style (JSDoc comments, imports, etc.)
- Do NOT modify tests - a separate agent handles that
- After changes, run `npm run build` to verify compilation
```

#### coder-infra

```
You are working on the gibbons-mongodb library. Your task is to modernize the CI/CD and package configuration.

TASK 1: Update `.github/workflows/ci.yml`
- Change Node matrix to [18.x, 20.x, 22.x]
- Update actions to v4 (checkout@v4, setup-node@v4)
- Remove MONGOMS_VERSION env var (let mongodb-memory-server choose)
- Add `npm run build` step before `npm test`

TASK 2: Update `.github/workflows/npm-publish.yml`
- Change trigger from `push: branches: [master]` to `release: types: [published]`
- Update actions to v4
- Use Node 20 for publish jobs
- Add npm provenance (`--provenance --access public`)
- Add proper permissions blocks

TASK 3: Fix package.json
- Add `peerDependencies: { "mongodb": "^6.0.0" }`
- Update `engines.node` to `">=18.0.0"`
- Add `"homepage": "https://github.com/icazemier/gibbons-mongodb#readme"`
- Add `"bugs": { "url": "https://github.com/icazemier/gibbons-mongodb/issues" }`
- Do NOT change the version number

TASK 4: Clean up `.npmignore`
Replace contents with:
  src/
  test/
  coverage/
  docs/
  .github/
  .claude/
  .vscode/
  .nvmrc
  .editorconfig
  .prettierrc.json
  eslint.config.js
  tsconfig.json
  tsconfig-build-*.json
  vite.config.ts
  fixup.mjs
  CLAUDE.md
  **/*.spec.ts
  *.svg

TASK 5: Create `.nvmrc` with content: 20

IMPORTANT: Read files before editing. Do not modify source code or tests.
```

#### tester

```
You are working on the gibbons-mongodb library. Your task is to write tests for two newly added methods.

The test file is `src/gibbons-mongo-db.spec.ts`. Follow the existing test patterns exactly:
- Tests use vitest (describe/it/expect)
- Tests use mongodb-memory-server via MongoDbTestServer.uri
- Test fixtures are in `test/helper/fixtures.ts`
- Test interfaces: TestUser, TestGroup, TestPermission

TASK 1: Add test for `findPermissions(positions)`
Add inside the existing `describe('Happy flows')` block:
```typescript
it('Find permissions by positions', async () => {
  const permissions = await mongoDbAdapter
    .findPermissions([
      PERMISSION_POSITIONS_FIXTURES.GOD_MODE,
      PERMISSION_POSITIONS_FIXTURES.ADMIN,
    ])
    .toArray() as TestPermission[];

  expect(permissions).toHaveLength(2);
  const names = permissions.map(p => p.name);
  expect(names).toContain('God mode');
  expect(names).toContain('Admin');
  permissions.forEach(p => {
    expect(p.gibbonIsAllocated).toBe(true);
  });
});
```

TASK 2: Add test for `updateUserMetadata(filter, data)`
```typescript
it('Update user metadata', async () => {
  const updated = await mongoDbAdapter.updateUserMetadata(
    { name: 'Cooper' },
    { email: 'cooper@updated.com' }
  ) as TestUser;

  expect(updated).not.toBeNull();
  expect(updated.email).toBe('cooper@updated.com');
  expect(updated.name).toBe('Cooper');
  expect(updated.permissionsGibbon).toBeInstanceOf(Gibbon);
  expect(updated.groupsGibbon).toBeInstanceOf(Gibbon);
});

it('Update user metadata returns null for non-existent user', async () => {
  const result = await mongoDbAdapter.updateUserMetadata(
    { name: 'NonExistent' },
    { email: 'nope@nope.com' }
  );
  expect(result).toBeNull();
});
```

TASK 3: Run the full test suite
Run `npm test` and verify ALL tests pass (existing + new).
Report coverage numbers.

IMPORTANT: Read the test file before editing. Match the existing style exactly.
Import Gibbon at the top if not already imported (it is).
```

#### docs-writer

```
You are working on the gibbons-mongodb library. Create documentation for open source release.

TASK 1: Create `docs/README.md` (this will be copied to root for publishing)

Structure:
# @icazemier/gibbons-mongodb

> Bitwise user groups and permissions management for MongoDB

## Features
- Efficient bitwise storage for groups and permissions
- Pre-allocated slots with automatic position management
- Cascading permission updates when groups change
- MongoDB FindCursor-based queries (streamable)
- Dual ESM/CJS builds
- CLI tool for database initialization

## Installation
npm install @icazemier/gibbons-mongodb mongodb

## Quick Start
Show: create config, seed database, initialize GibbonsMongoDb, allocate permissions,
allocate groups, subscribe permissions to groups, create user, subscribe user to groups,
validate permissions.

## API Reference
Table of ALL public methods on GibbonsMongoDb:

### Permissions
| Method | Description |
|--------|-------------|
| allocatePermission(data) | Allocate next available permission slot |
| deallocatePermissions(positions) | Deallocate and cascade-remove from groups/users |
| findPermissions(positions) | Find permission documents by positions |
| findAllAllocatedPermissions() | List all allocated permissions |
| updatePermissionMetadata(position, data) | Update custom fields on a permission |
| validateAllocatedPermissions(positions) | Check if positions are allocated |

### Groups
| Method | Description |
|--------|-------------|
| allocateGroup(data) | Allocate next available group slot |
| deallocateGroups(positions) | Deallocate and remove membership from users |
| findGroups(positions) | Find group documents by positions |
| findGroupsByPermissions(permissions) | Find groups that have specific permissions |
| findAllAllocatedGroups() | List all allocated groups |
| updateGroupMetadata(position, data) | Update custom fields on a group |
| subscribePermissionsToGroups(groups, permissions) | Add permissions to groups |
| unsubscribePermissionsFromGroups(groups, permissions) | Remove permissions from groups |
| validateAllocatedGroups(positions) | Check if positions are allocated |

### Users
| Method | Description |
|--------|-------------|
| createUser(data) | Create a new user with empty gibbons |
| removeUser(filter) | Remove users matching filter |
| findUsers(filter) | Find users by MongoDB filter |
| findUsersByGroups(groups) | Find users subscribed to specific groups |
| findUsersByPermissions(permissions) | Find users with specific permissions |
| updateUserMetadata(filter, data) | Update custom fields on a user |
| subscribeUsersToGroups(filter, groups) | Subscribe users to groups |
| unsubscribeUsersFromGroups(filter, groups) | Unsubscribe users from groups |

### Validation
| Method | Description |
|--------|-------------|
| validateUserGroupsForAllGroups(userGroups, groups) | Check user has ALL groups |
| validateUserGroupsForAnyGroups(userGroups, groups) | Check user has ANY groups |
| validateUserPermissionsForAllPermissions(userPerms, perms) | Check user has ALL permissions |
| validateUserPermissionsForAnyPermissions(userPerms, perms) | Check user has ANY permissions |
| getPermissionsGibbonForGroups(groups) | Get aggregated permissions for groups |

## CLI
npx gibbons-mongodb init --uri=mongodb://localhost:27017

## Configuration
Explain the Config interface and cosmiconfig resolution.

## License
MIT

TASK 2: Create `docs/CONTRIBUTING.md`

TASK 3: Create `docs/CHANGELOG.md` starting from v1.0.0

IMPORTANT:
- Write in `docs/` directory, NOT root
- Do not add emojis
- Keep it concise and practical
```

#### reviewer

```
You are reviewing the gibbons-mongodb library for open source release quality.

TASK 1: Fix inconsistent spelling
In `src/seeder.ts`, the public method `initialise()` uses British spelling while the rest
of the codebase uses American spelling (`initialize`).
- Add `initialize()` as the primary method
- Keep `initialise()` as a deprecated alias
- Update `src/bin/init.ts` to call `initialize()` (it already calls `initialise()` via `initialize`)
- Check the MongoDbSeeder class — it already has `initialise()` calling `populateGroupsAndPermissions()`

TASK 2: Verify the build
Run `npm run build` and check that:
- build/esm/ and build/cjs/ directories are created
- No TypeScript errors
- Entry points in package.json resolve to existing files

TASK 3: Run lint
Run `npm run lint` and fix any issues found.

TASK 4: Run full tests
Run `npm test` and report results + coverage summary.

IMPORTANT: Read files before editing. Make minimal changes.
```

---

## Pre-flight Checklist

Before executing the swarm, verify:

- [ ] `npm ci` succeeds (dependencies installed)
- [ ] `npm test` passes (baseline green)
- [ ] `npm run build` succeeds (baseline compiles)
- [ ] Git working tree is clean (`git status`)

## Post-swarm Checklist

After all agents complete:

- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] New methods `findPermissions` and `updateUserMetadata` work
- [ ] README.md is comprehensive and accurate
- [ ] CI workflows use modern actions and Node versions
- [ ] `peerDependencies` includes `mongodb`
- [ ] `.npmignore` is cleaned up
- [ ] No secrets or `.env` files in the repo
- [ ] Git diff reviewed for correctness

## Execution Command

```bash
# 1. Verify baseline
npm ci && npm run build && npm test && npm run lint

# 2. Create branch
git checkout -b release/v1.0.0-open-source

# 3. Execute swarm (use Claude Code Task tool with run_in_background: true for all agents)
# See agent prompts above

# 4. After all agents complete, verify
npm run build && npm test && npm run lint

# 5. Commit
git add -A
git commit -m "feat: complete API + open source release preparation

- Add findPermissions() for position-based permission lookup
- Add updateUserMetadata() for user custom field updates
- Modernize CI/CD to Node 18/20/22 with actions v4
- Add peerDependencies for mongodb
- Add README, CONTRIBUTING, CHANGELOG
- Fix initialise/initialize spelling inconsistency
- Clean up .npmignore for current project structure

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
