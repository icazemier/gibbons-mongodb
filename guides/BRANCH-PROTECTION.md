# Branch Protection Setup Guide

This document explains how to configure GitHub branch protection rules to prevent faulty pushes and maintain code quality.

## Quick Setup

Go to your GitHub repository:
1. Navigate to **Settings** → **Branches**
2. Click **Add branch protection rule**
3. Apply the settings below

---

## Recommended Branch Protection Rules

### For `main` and `master` Branches

**Branch name pattern:** `main` (create another rule for `master`)

#### ✅ Required Settings:

**1. Require a pull request before merging**
- ✅ Enable this
- ✅ Require approvals: **1** (or more for team projects)
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require review from Code Owners (after setting up CODEOWNERS)

**2. Require status checks to pass before merging**
- ✅ Enable this
- ✅ Require branches to be up to date before merging
- Search and add these required checks:
  - `test (18.x)` - Tests on Node 18
  - `test (20.x)` - Tests on Node 20
  - `test (22.x)` - Tests on Node 22
  - `test (24.x)` - Tests on Node 24

**3. Require conversation resolution before merging**
- ✅ Enable this (ensures all review comments are addressed)

**4. Require signed commits** (Optional but recommended)
- ✅ Enable this for extra security

**5. Require linear history** (Optional)
- ✅ Enable this to prevent merge commits (cleaner history)

**6. Include administrators**
- ✅ Enable this (even admins must follow the rules)

**7. Restrict who can push to matching branches**
- ✅ Enable this
- Add only trusted maintainers/admins
- Or leave empty to require PRs from everyone

**8. Allow force pushes**
- ❌ Disable this (prevents rewriting history)

**9. Allow deletions**
- ❌ Disable this (prevents accidental branch deletion)

---

### For `development` Branch

**Branch name pattern:** `development`

Use similar settings but slightly less strict:

**1. Require a pull request before merging**
- ✅ Enable this
- ✅ Require approvals: **1**
- ⚠️ Optional: Allow bypass for maintainers (for quick fixes)

**2. Require status checks to pass before merging**
- ✅ Enable this
- ✅ Require branches to be up to date
- Add required checks:
  - `test (18.x)`
  - `test (20.x)`
  - `test (22.x)`
  - `test (24.x)`

**3. Allow force pushes**
- ⚠️ Optional: Enable for maintainers only (if needed for rebasing)

---

## Visual Reference

### Settings Screenshot Path:
```
GitHub Repo → Settings → Branches → Add branch protection rule
```

### Example Configuration:

```yaml
Branch name pattern: main

✓ Require a pull request before merging
  ✓ Require approvals: 1
  ✓ Dismiss stale pull request approvals when new commits are pushed
  ✓ Require review from Code Owners

✓ Require status checks to pass before merging
  ✓ Require branches to be up to date before merging
  Required checks:
    - test (18.x)
    - test (20.x)
    - test (22.x)
    - test (24.x)

✓ Require conversation resolution before merging

✓ Require signed commits (optional)

✓ Require linear history (optional)

✓ Include administrators

✗ Allow force pushes
✗ Allow deletions
```

---

## Additional Security Measures

### 1. Enable CODEOWNERS

A `.github/CODEOWNERS` file has been created. This automatically requests reviews from specified users.

### 2. Require Two-Factor Authentication

Require 2FA for all contributors:
- Go to **Settings** → **Security** → **Authentication security**
- Enable "Require two-factor authentication"

### 3. Dependabot Security Updates

Enable automatic security updates:
- Go to **Settings** → **Security** → **Code security and analysis**
- Enable "Dependabot alerts"
- Enable "Dependabot security updates"

### 4. Secret Scanning

- Enable in **Settings** → **Security** → **Code security and analysis**
- Enable "Secret scanning"
- Enable "Push protection" to prevent secrets from being pushed

---

## Workflow After Setup

### For Contributors:

1. **Fork the repository** (external contributors)
2. **Create a feature branch** from `development`
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/my-feature
   ```
3. **Make changes** and commit using conventional commits
   ```bash
   npm run commit
   ```
4. **Push to your branch**
   ```bash
   git push origin feature/my-feature
   ```
5. **Open a Pull Request** to `development`
6. **Wait for reviews** and status checks to pass
7. **Address review comments** if any
8. **Merge** once approved (maintainer will merge)

### For Maintainers:

- Review PRs carefully
- Ensure all CI checks pass
- Verify conventional commit format
- Merge using "Squash and merge" for cleaner history
- Delete feature branches after merging

---

## Testing Branch Protection

After setting up, test it:

1. Try to push directly to `main`:
   ```bash
   git push origin main
   ```
   ❌ Should be rejected

2. Try to create a PR without passing tests:
   - Should block merging until tests pass

3. Try to merge without approval:
   - Should require at least 1 approval

---

## Bypass Protection (Emergency Only)

If you absolutely need to bypass protection (e.g., critical hotfix):

1. Temporarily disable branch protection
2. Push your fix
3. **Immediately re-enable protection**

⚠️ **Not recommended** - Use only in true emergencies!

---

## Resources

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [CODEOWNERS Documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Semantic Versioning Guide](./SEMANTIC-VERSIONING.md)

---

## Questions?

If you have questions about branch protection setup, open an issue or reach out to the maintainers.
