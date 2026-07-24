# Drive Mad archive

A local, offline-capable archive of Drive Mad with 30 playable Poki builds from
August 2022 through June 2026. The launcher includes a build switcher, upstream
release UUIDs, embedded Fancade runtime versions where recoverable, and SHA-256
duplicate detection.

The archived game remains the property of Martin Magni / Fancade and their
licensors. Do not redistribute it without permission.

## Getting started

```bash
pnpm install
pnpm dev              # local dev server (requires Node.js 22.13+, pnpm)
```

Open <http://localhost:3000>. Once installed, playing does not require internet
access.

## Updating the archive

```bash
pnpm update-game       # fetch Poki's current live build
pnpm archive-versions  # discover new builds from Wayback Machine & Arquivo.pt
pnpm request-archive   # ask Wayback to capture current live game URLs
pnpm sync              # run update-game + archive-versions
pnpm verify-archive    # check all files, SDK paths, and WASM headers
```

The sync workflow (`.github/workflows/sync.yml`) runs these steps automatically
every 6 hours and commits any new builds found.

`public/versions/manifest.json` is generated automatically. Each entry includes:
archive number, Poki release UUID, earliest archive capture date, Fancade
runtime version (if embedded), SHA-256 hashes (WASM, data, combined runtime),
and cross-links to builds sharing identical assets.

Archive dates indicate when a build was *observed online*, not when it was
released. Newer binaries no longer embed a Fancade version string, so the Poki
UUID is the authoritative upstream identifier.

## Archive coverage

The downloader queries both Poki CDN hostnames through:

- [Internet Archive / Wayback CDX](https://web.archive.org/);
- [Arquivo.pt](https://arquivo.pt/) CDN and wrapper captures.

Arquivo.pt contributed three complete builds that Wayback missed. Common Crawl
was checked but did not index usable game-CDN assets.

## Extending the archive

### Periodic automation

A scheduled GitHub Actions workflow (`.github/workflows/sync.yml`) runs
`pnpm sync` every 6 hours, automatically committing any newly discovered
builds. It also requests the Wayback Machine's Save Page Now API to capture
the live game URLs, ensuring future runs have fresh archives to query.

To enable the workflow in your fork:

1. Go to **Actions** → **Sync archive** → **Enable**
2. The workflow runs automatically on the `*/6 * * *` schedule

You can also trigger it manually from the Actions tab.

### Fancade version gaps

Compare the embedded Fancade runtime versions across builds:

| Version | Date range |
|---------|-----------|
| 1.10.2  | Aug–Sep 2022 |
| 1.11.7  | Nov–Dec 2022 |
| 1.12.1  | Feb 2023 |
| 1.13.0  | May 2023 |
| 1.13.5  | Sep–Oct 2023 |
| 1.14.5  | Feb–Nov 2024 |
| *(not embedded)* | 2025 onward |

Gaps in the version sequence (e.g., 1.10.x → 1.11.0–1.11.6, 1.13.0 → 1.13.1–1.13.4,
1.14.5 → next) indicate likely missing builds. Focus CDX date-range queries on
those periods.

## Deployment

This project can be deployed as a static site on any hosting platform (GitHub
Pages, Cloudflare Pages, Netlify, etc.). A GitHub Actions workflow
(`.github/workflows/pages.yml`) handles verification and deployment.

```bash
pnpm build:pages       # build static site into gh-pages/
```

## Archive structure

```
public/versions/<release UUID>/
├── index.html
└── webapp/
    ├── fancade.css
    ├── source_min.js
    ├── index.js
    ├── index.data
    └── index.wasm
```

Local copies replace Poki's online SDK with `public/poki-sdk.js`. The HTML
uses a relative SDK path so builds work both locally and from a hosted page.

Sources: [Poki](https://poki.com/en/g/drive-mad),
[Fancade wiki](https://www.fancade.com/wiki/Drive_Mad),
[Arquivo.pt](https://arquivo.pt/),
[Common Crawl](https://index.commoncrawl.org/).
