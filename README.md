# Eit Smart Linker

An Obsidian plugin with two tools for the Eit vault:

1. **Alias Seeder** — proposes filename-based aliases for notes and lets you
   edit/confirm them into frontmatter before saving.
2. **Smart Linker** — scans a note (or the whole vault) for mentions of other
   notes by name or alias, and offers to convert them into
   `[[Target|Alias]]` links. Nothing is written until you review and approve
   a preview.

## Commands

- **Suggest Aliases: Current File** — proposes aliases for the active note.
- **Suggest Aliases: All Files Missing Aliases** — walks every note in the
  vault that has no `aliases` frontmatter yet, one at a time.
- **Smart Link: Current File** — finds linkable mentions in the active note.
- **Smart Link: Entire Vault** — finds linkable mentions across every note.

All four are run from the Command Palette (`Ctrl/Cmd+P`), search "Smart
Link" or "Suggest Aliases."

## How matching works

- A note is matchable by its **filename** and by any strings listed in its
  `aliases:` frontmatter field.
- Matching is **case-sensitive** and uses word boundaries (won't match
  "Amp" inside "Ampere").
- Longer names are matched before shorter ones, so "Amp Rhythmax" claims its
  full span before "Amp" tries to match separately.
- Text inside frontmatter, code blocks, inline code, and existing `[[links]]`
  is skipped.
- A note never links to itself.
- No folder restrictions — creatures can link to locations, items can link
  to NPCs, etc. Everything in the vault is a valid link target.

## Recommended first run

1. Run **Suggest Aliases: All Files Missing Aliases** once to seed
   `aliases:` frontmatter across your vault (e.g. `Amp Rhythmax` gets
   `Amp` as a suggested alias; add true nicknames like `Nell` for
   `Cornelia VanLover` manually since those aren't substrings of the name).
2. Run **Smart Link: Entire Vault**, review the preview, resolve any
   ambiguous matches via the dropdown, and click Apply.
3. For day-to-day writing, use **Smart Link: Current File** on individual
   notes as you finish them.

## Building & releasing (fully automated — nothing runs locally)

This repo includes `.github/workflows/release.yml`. Every time you push a
version tag, GitHub's own servers install dependencies, run the build, and
publish `main.js`, `manifest.json`, and `versions.json` as a GitHub Release.
You never need Node.js or npm installed on your machine.

To cut a release after pushing code changes:

```bash
git tag 1.0.0
git push origin 1.0.0
```

(Bump the version number in both `manifest.json` and `versions.json` before
tagging, and make sure the tag name matches the `version` field in
`manifest.json` exactly — BRAT relies on that match.)

Check the **Actions** tab on GitHub to watch the build run, and the
**Releases** tab once it's done to confirm `main.js` is attached.

## Installing into your vault via BRAT (no manual file copying)

1. In Obsidian: **Settings → Community Plugins → Browse**, search for
   **"BRAT"** (Beta Reviewer's Auto-update Tool), install and enable it.
2. Open BRAT's settings (or Command Palette → **"BRAT: Add a beta plugin
   for testing"**).
3. Paste your repo URL: `https://github.com/YOUR-USERNAME/eit-smart-linker`
4. BRAT pulls the latest GitHub Release automatically and installs it into
   `.obsidian/plugins/eit-smart-linker/` for you.
5. Enable **"Eit Smart Linker"** under Settings → Community Plugins.

Whenever you push a new tag/release, BRAT will pick up the update
automatically (or on-demand via **"BRAT: Check for updates"**).

## Repository structure

```
eit-smart-linker/
  main.ts              # plugin source (edit this)
  main.js              # compiled output (generated, gitignored)
  manifest.json         # plugin metadata Obsidian reads
  versions.json         # Obsidian version compatibility map
  package.json
  tsconfig.json
  esbuild.config.mjs
  .gitignore
  README.md
```

## Roadmap ideas (not yet built)

- Settings tab to exclude specific folders from indexing, if that's ever
  wanted later.
- Bulk "resolve all ambiguous the same way" option in the preview modal.
- Option to also match partial tokens live (not just seeded aliases).
