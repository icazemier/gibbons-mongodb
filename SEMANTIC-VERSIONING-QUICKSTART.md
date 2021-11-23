# Semantic Versioning

This project uses automated semantic versioning. See [docs/SEMANTIC-VERSIONING.md](docs/SEMANTIC-VERSIONING.md) for the complete guide.

## Quick Start

### Making a Commit

Use the interactive commit tool:
```bash
npm run commit
```

Or manually follow [Conventional Commits](https://www.conventionalcommits.org/) format:
```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug"
git commit -m "docs: update readme"
```

### Version Bumps

- `feat:` → Minor version (1.0.0 → 1.1.0)
- `fix:`, `perf:`, `docs:`, `refactor:` → Patch version (1.0.0 → 1.0.1)
- `feat!:` or `BREAKING CHANGE:` → Major version (1.0.0 → 2.0.0)
- `test:`, `chore:`, `ci:` → No release

### Automated Release

Releases happen automatically when you push to:
- `main`/`master` → Stable release (e.g., `1.0.0`)
- `development` → Beta pre-release (e.g., `1.1.0-beta.1`)

Read the full guide: [docs/SEMANTIC-VERSIONING.md](docs/SEMANTIC-VERSIONING.md)
