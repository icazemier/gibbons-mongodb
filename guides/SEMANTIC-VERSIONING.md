# Semantic Versioning Guide

This project uses automated semantic versioning with [semantic-release](https://semantic-release.gitbook.io/).

## How It Works

Version bumps are **automatically determined** by your commit messages using [Conventional Commits](https://www.conventionalcommits.org/).

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Types and Version Bumps

| Type | Version Bump | Description | Example |
|------|--------------|-------------|---------|
| `feat` | **MINOR** (0.x.0) | New feature | `feat: add updateUserMetadata method` |
| `fix` | **PATCH** (0.0.x) | Bug fix | `fix: correct type error in validation` |
| `perf` | **PATCH** (0.0.x) | Performance improvement | `perf: optimize gibbon decoding` |
| `docs` | **PATCH** (0.0.x) | Documentation only | `docs: update quickstart guide` |
| `refactor` | **PATCH** (0.0.x) | Code refactoring | `refactor: simplify permission logic` |
| `test` | No release | Test changes | `test: add error handling tests` |
| `build` | No release | Build system changes | `build: update dependencies` |
| `ci` | No release | CI configuration | `ci: add release workflow` |
| `chore` | No release | Maintenance tasks | `chore: update dev dependencies` |
| `revert` | **PATCH** (0.0.x) | Revert previous commit | `revert: revert feat: add X` |

#### Breaking Changes = MAJOR (x.0.0)

Add `BREAKING CHANGE:` in the footer or `!` after type:

```bash
feat!: change API signature for validateUser

BREAKING CHANGE: validateUser now requires Buffer instead of Uint8Array
```

### Examples

**Minor version (1.0.0 → 1.1.0):**
```bash
git commit -m "feat: add findPermissions method"
```

**Patch version (1.0.0 → 1.0.1):**
```bash
git commit -m "fix: resolve type compatibility issue"
```

**Major version (1.0.0 → 2.0.0):**
```bash
git commit -m "feat!: redesign user subscription API

BREAKING CHANGE: subscribeUsers now takes Filter instead of query object"
```

**No release:**
```bash
git commit -m "test: improve coverage for seeder"
git commit -m "chore: update README"
```

## Using Commitizen (Recommended)

Instead of writing commit messages manually, use the interactive tool:

```bash
npm run commit
```

This launches a wizard that helps you create properly formatted commits.

## Workflow

### 1. Install Dependencies
```bash
npm install
```

This automatically sets up git hooks via Husky.

### 2. Make Changes
```bash
# Edit files
git add .
```

### 3. Commit with Conventional Format
```bash
# Option A: Use commitizen (recommended)
npm run commit

# Option B: Manual commit
git commit -m "feat: add new feature"
```

The git hook will validate your commit message format.

### 4. Push to Branch
```bash
git push origin development
```

### 5. Automated Release

When you push to `main` or `master` branch:
1. ✅ Tests run
2. 📦 Build artifacts are created
3. 🔢 Version is automatically bumped based on commits
4. 📝 CHANGELOG.md is updated
5. 🏷️ Git tag is created
6. 📤 Package is published to npm
7. 🎉 GitHub release is created

For `development` branch:
- Creates pre-release versions (e.g., `1.1.0-beta.1`)

## Pre-release Testing

Test what version would be released without actually releasing:

```bash
npm run release:dry
```

## Branch Strategy

| Branch | Release Type | Example Version |
|--------|--------------|-----------------|
| `main` / `master` | Stable releases | `1.0.0`, `1.1.0`, `2.0.0` |
| `development` | Beta pre-releases | `1.1.0-beta.1`, `1.1.0-beta.2` |

## Commit Message Rules

✅ **Valid:**
```bash
feat: add user export functionality
fix(validation): correct edge case in gibbon decode
docs: update installation guide
```

❌ **Invalid:**
```bash
Added new feature                    # Missing type
feat Add user export                 # Missing colon
feat: Add user export.               # Ends with period
FEAT: add user export               # Type must be lowercase
```

## Tips

1. **Small commits**: One logical change per commit
2. **Clear subjects**: Describe what changed, not how
3. **Use scope**: Help categorize changes (`fix(api):`, `feat(cli):`)
4. **Breaking changes**: Always document in footer
5. **Link issues**: Reference issues in footer (`Closes #123`)

## Example Complete Commit

```bash
feat(api): add bulk user permission update

Add new method updateUsersPermissions() that allows updating
permissions for multiple users in a single operation.

This improves performance when syncing permissions from
external systems.

Closes #42
```

## GitHub Secrets Required

For CI/CD to work, ensure these secrets are set in GitHub repo settings:

- `NPM_TOKEN` - npm authentication token for publishing
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

## Troubleshooting

**"Commit message does not follow format"**
- Use `npm run commit` or check examples above

**"No release published"**
- No commits with `feat`/`fix`/`perf` since last release
- Or only `chore`/`test`/`ci` commits (these don't trigger releases)

**"Release failed"**
- Check GitHub Actions logs
- Verify NPM_TOKEN is valid
- Ensure tests pass locally first
