# Building WAPresence from Source

This guide covers how to set up the build environment and compile WAPresence and its required dependencies from source.

---

## Important Notice: Custom Baileys Fork Required

WAPresence relies on a custom fork of `@whiskeysockets/baileys` (Pull Request #2798 by `crowroser`, branch `fix/update-profile-status-about`). 

**Warning**: This fork is **not official** and is maintained separately from upstream WhiskeySockets/Baileys. 

### Why is this fork required?
Modern WhatsApp text status (About/Bio) requires GraphQL MEX mutations (`xwa2_update_text_status`). Upstream npm Baileys (`@whiskeysockets/baileys` v7.0.0-rc.9) only updates the legacy status stanza (`<iq xmlns="status">`), which is ignored by modern WhatsApp mobile and web clients. This fork implements the necessary GraphQL MEX mutation to update your visible status.

---

## Workspace Directory Structure

WAPresence references Baileys using a local file path (`file:../Baileys`). Both repositories must be cloned side-by-side in the same parent directory:

```text
projects/
├── Baileys/       <- Custom Baileys fork (branch: fix/update-profile-status-about)
└── WAPresence/    <- WAPresence repository
```

---

## Prerequisites

- **Node.js**: Version 22 LTS or newer.
- **Git**: Installed and available in your PATH.
- **Package Manager**: `pnpm` (recommended), `npm`, or `yarn`.

---

## Step-by-Step Build Instructions

### Step 1: Open a Terminal in Your Projects Directory

Open Command Prompt, PowerShell, or a terminal in the folder where you keep your development repositories (for example, `C:\projects` or `~/projects`):

```bash
cd C:\projects
```

### Step 2: Clone the Baileys Fork

Clone the specific branch `fix/update-profile-status-about` from the `crowroser/Baileys` repository:

```bash
git clone -b fix/update-profile-status-about https://github.com/crowroser/Baileys.git
```

> **Common Pitfall**: Do not use the GitHub website URL (`https://github.com/crowroser/Baileys/tree/fix/update-profile-status-about`). Git will return `fatal: repository not found`. Always clone using the `.git` repository URL with the `-b <branch>` flag shown above.

### Step 3: Clone WAPresence

In the same parent folder, clone the WAPresence repository:

```bash
git clone https://github.com/Fluntyy/WAPresence.git
```

Verify that both folders exist side-by-side:
- `C:\projects\Baileys`
- `C:\projects\WAPresence`

### Step 4: Build Baileys

Upstream git dependencies do not include pre-compiled JavaScript in their repository. Baileys must be compiled before WAPresence can consume it.

WAPresence includes a helper script (`scripts/prepare-baileys.js`) that automatically patches Baileys dependencies, removes strict packageManager locks, and configures build flags:

```bash
# Navigate to WAPresence and run the prepare script
cd WAPresence
node scripts/prepare-baileys.js ../Baileys

# Navigate to Baileys and build it
cd ../Baileys
pnpm install
pnpm run build
```

*(If you are using npm instead of pnpm, run `npm install` and `npm run build` inside `Baileys`).*

### Step 5: Install WAPresence Dependencies & Build

Navigate to the `WAPresence` directory, install dependencies, and build the project:

```bash
cd ../WAPresence
pnpm install
pnpm run build
```

---

## Running and Packaging

Once built, you can run or package the application:

### Run in Development Mode
```bash
pnpm start
```

### Run Unit Tests
```bash
pnpm test
```

### Create Unpacked Binary
Produces an unpackaged binary inside `release/win-unpacked/WAPresence.exe` for local testing:
```bash
pnpm run pack
```

### Build Production Installers & Executables
Packages the full production installer (NSIS) and portable executable in the `release/` folder:
```bash
pnpm run dist
```

---

## Troubleshooting

### Error: `Could not install from "..\Baileys" as it does not exist`
- Cause: WAPresence expects `Baileys` to be a sibling folder located at `../Baileys`.
- Solution: Make sure both `Baileys` and `WAPresence` are inside the same parent directory.

### Error: `fatal: repository '.../tree/...' not found`
- Cause: The GitHub browser URL was passed to `git clone` instead of the repository clone URL.
- Solution: Use `git clone -b fix/update-profile-status-about https://github.com/crowroser/Baileys.git`.

### Error: `ERR_PNPM_IGNORED_BUILDS` or packageManager mismatch
- Cause: Baileys package.json defaults to yarn or requires specific dependencies for compilation.
- Solution: Run `node scripts/prepare-baileys.js ../Baileys` from the `WAPresence` directory before running `pnpm install` in `Baileys`.
