# Drive Mad archive

A local, offline-capable archive of Drive Mad with 30 playable Poki builds from
August 2022 through June 2026. The launcher includes a build switcher, upstream
release UUIDs, embedded Fancade runtime versions where recoverable, and SHA-256
duplicate detection.

The archived game remains the property of Martin Magni / Fancade and their
licensors. Do not redistribute it without permission.

## Run locally

Requires Node.js 22.13+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Once installed, playing does not require internet
access.

## Update and verify

```bash
pnpm update-game       # resolve and download Poki's current build
pnpm archive-versions  # resume discovery from Wayback and Arquivo.pt
pnpm sync              # run both update steps
pnpm verify-archive    # verify files, SDK paths, and WASM headers
```

`public/versions/manifest.json` is generated automatically. Each entry has:

- a stable local archive number (`archiveNumber`);
- Poki's actual release UUID (`id`);
- the earliest public archive date found (`capturedAt`);
- an embedded Fancade runtime version when the binary exposes one;
- SHA-256 hashes for the WASM, data pack, and combined runtime;
- links to any build with identical WASM, data, or combined runtime.

Archive dates are evidence of when a build was live, not official release dates.
Newer binaries no longer expose a readable Fancade semantic version, so the
Poki UUID remains their only authoritative upstream build identifier.

## Archive coverage

The downloader searches both Poki CDN hostnames through:

- Internet Archive / Wayback CDX;
- Arquivo.pt CDN and wrapper captures.

Arquivo.pt added three complete builds missed by Wayback. Common Crawl was also
checked but did not index usable game-CDN assets. Archive.today had no matching
wrapper capture, and the former Memento Time Travel aggregator was retired in
2025.

## GitHub Pages

The repository includes a static Vite build and a Pages deployment workflow.

```bash
pnpm build:pages
```

The result is written to `gh-pages/`. It uses relative URLs, so it works at both
`username.github.io` and `username.github.io/repository-name`.

To publish:

1. Create an empty GitHub repository.
2. Add it as `origin` and push `main`.
3. In the repository's **Settings → Pages**, select **GitHub Actions** as the
   source if GitHub does not select it automatically.

Every push to `main` then verifies all builds and deploys the static site using
`.github/workflows/pages.yml`.

## Hosting notes

GitHub Pages is adequate for this archive: the generated site is under the
Pages artifact limit and every individual file is below GitHub's 100 MB file
limit. Cloudflare Pages or another static host is also suitable. A conventional
server is unnecessary because the launcher has no backend.

## Hosting structure

Poki's wrapper resolves to a release-specific CDN directory:

```text
<game UUID>.gdn.poki.com/<release UUID>/
├── index.html
└── webapp/
    ├── fancade.css
    ├── source_min.js
    ├── index.js
    ├── index.data
    └── index.wasm
```

Local copies replace Poki's online SDK with `public/poki-sdk.js`. The HTML uses
a relative SDK path so builds work locally and from a GitHub project page.

Sources: [Poki](https://poki.com/en/g/drive-mad),
[Fancade wiki](https://www.fancade.com/wiki/Drive_Mad),
[Arquivo.pt](https://arquivo.pt/), and
[Common Crawl](https://index.commoncrawl.org/).
