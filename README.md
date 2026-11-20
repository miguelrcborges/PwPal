# PwPal

A dependency-free, local password generator. No build step, account, or server-side code.

## Run / install

Serve this folder with any static web server, for example:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. For a phone, deploy to an **HTTPS** static host (a subdirectory works too). Plain HTTP on a LAN IP and `file://` do not support the required browser APIs.

Wait for **Offline ready** before disconnecting. Use Install when offered, the browser's install menu, or on iPhone, **Share → Add to Home Screen**. Open the installed app once online and check Offline ready there too; some browsers keep installed-app storage separate.

## Provider rules

Edit a provider to append literal characters and/or replace symbols by position: `+/=` → `-_!` replaces `+` with `-`, `/` with `_`, and `=` with `!`. Both replacement fields must have the same character count, with no repeated characters in **Replace symbols**. Replacements happen in a single pass over the base password, so they do not cascade. Appended characters are unchanged and increase the total length. Leave the rules empty to keep the original password; existing single-symbol rules still work.

Existing `[name, length]` records remain supported. New records use `[name, length, suffix, replaceFrom, replaceTo]`, in the same `pwpal-sources` browser-storage key. Export backs up these settings, **not** the master password. Names and rules are stored as plain text; do not put secrets in them. Changing the master password, name, length, or rules changes the result.

Use **Import** to select an exported JSON file. The whole file is validated before saving. Import keeps existing providers and skips identical settings, including duplicates in the file. Providers with the same name but different settings are both kept; names remain case-sensitive because they affect the generated password.

The original SHA-256 derivation, including its unusual byte conversion, is deliberately unchanged. This is not a slow password KDF or a security-audited vault: use a strong, unique master password. There is no recovery if you forget it. Clearing browser/app data removes provider settings, so keep an export.

## Checks / updates

Run `node --test tests/main.test.cjs` (Node 18+), or `bun test tests/main.test.cjs`. No packages are needed.

When publishing changed app files, bump `CACHE_NAME` in `sw.js`. The new offline version takes over after all open PwPal tabs/windows are closed and the app is reopened.
