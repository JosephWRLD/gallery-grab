<p align="center"><img src="branding/logo.png" alt="Gallery Grab" width="160"></p>

<h1 align="center">Gallery Grab</h1>

<p align="center"><a href="README.md">Türkçe</a> · <b>English</b></p>

<p align="center">
  <a href="https://github.com/JosephWRLD/gallery-grab/releases"><img alt="Chrome extension" src="https://img.shields.io/github/manifest-json/v/JosephWRLD/gallery-grab?label=Chrome%20extension&color=1f6feb"></a>
  <a href="https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js"><img alt="Tampermonkey" src="https://img.shields.io/github/v/release/JosephWRLD/gallery-grab?sort=semver&label=Tampermonkey&color=00485b"></a>
  <a href="https://github.com/JosephWRLD/gallery-grab/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JosephWRLD/gallery-grab/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-8957e5"></a>
</p>

<p align="center">Adds a <b>FUT Gallery</b> screen to the FC 27 Ultimate Team Web App: set progress, fut.gg's cheapest solutions and one-click buying of the missing cards.</p>

> [!WARNING]
> Automated buying on the Web App is against EA's terms of service; your account can be restricted or permanently banned. The project is free, not for sale, not affiliated with EA, and comes with no warranty. Details: [Disclaimer](#disclaimer-and-legal-notes).

## Features

<table>
<tr>
<td width="33%"><b>🖼️ Gallery screen</b><br>126 sets, league tabs, set score and D–S grades</td>
<td width="33%"><b>💡 fut.gg solutions</b><br>Cheapest card list for every grade; cards you own are deducted</td>
<td width="33%"><b>🛡️ Safe buying</b><br>Per-card price cap, budget, coin and transfer list checks</td>
</tr>
<tr>
<td><b>🎯 Token planner</b><br>Cheapest plan for a token target or a coin budget</td>
<td><b>🔄 Daily catalog</b><br>Refreshed from GitHub every day at 18:00 UTC</td>
<td><b>🌐 Türkçe / English</b><br>Flag language switcher</td>
</tr>
</table>

## How it works

1. **Sync all**: reads which cards of each set you have collected from EA.
2. Click a set and choose a grade tab (D·C·B·A·S).
3. **Sync + live prices**, then **Buy this solution**. Missing cards are bought from the current cheapest listing on the market.
4. To claim the tokens, grade the set **in-game** (console / PC) from the Gallery. The Web App cannot grade sets.

## Installation

There are two versions and both share the same code. **Don't install both.**

**Chrome extension (recommended)**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open the EA FC Web App and sign in. Once the game has loaded, a **GALLERY** tab appears at the bottom of the left menu.

**Updating:** Chrome never updates unpacked extensions; **Reload** only re-reads the files in the folder.
When a new version is out, the Gallery screen shows *New version available*. Run **`guncelle.bat`** in the extension
folder (downloads the latest release over the same folder), then press **Reload** in `chrome://extensions`.
Manually: download the latest `v1.x` zip from [Releases](https://github.com/JosephWRLD/gallery-grab/releases) and
extract it **over the same folder**. Don't remove the extension and load it from another folder — saved data is lost.

**Tampermonkey**

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Click **[Install the script](https://raw.githubusercontent.com/JosephWRLD/gallery-grab/main/userscript/gallery-grab.user.js)**.
3. Open the Web App and use the **GALLERY** tab in the left menu. Tampermonkey checks for updates on its own.

## Contact

Problems, bugs or ideas: **Discord `yusuflnx`** (top right of the Gallery screen; click to copy).

## Details

<details>
<summary><b>Gallery screen: all features</b></summary>

- **Sets by league tab:** Premier League / Barclays WSL, LALIGA / Liga F, Bundesliga, Ligue 1, Serie A, Leagues, Rarities (126 sets). Each card shows `collected / required`, set score, the grade reached (D·C·B·A·S), and below it: next tokens, earned, currently reachable tokens and points, maximum tokens.
- **Top bar:** gallery level (entered by hand from the game, because the Web App doesn't expose it), total gallery score, reachable points, earned / currently reachable / maximum tokens, completed sets, and sets **to grade in-game**.
- **Sync all:** reads the collection state of every set from EA (the Web App's "concept player" search returns `isCollected` and `gradingScore` for every card). It first shows how many sets will be synced and the estimated time, and can skip sets synced in the last 6 hours. If a set fails it retries once, then skips it and moves on.
- **Set detail (fut.gg solutions):** fut.gg's cheapest card solution for every grade. Cards you own are marked ✓ and deducted from the cost. **Sync + live prices** checks the current market price of the missing cards; **Buy this solution** buys them after confirmation.
- **Buying safety:**
  - Every card has a **price cap**: live price +25% if a live price was checked, otherwise 2× the fut.gg price (at least +2,000). The "Max per card" setting (default 50,000) applies on top.
  - Cards above the cap are not bought; the report shows their real price and the next attempt uses it.
  - There is also a **Gallery budget** (buying stops when gallery spending reaches it) and a coin balance check.
  - Buying stops when the transfer list is full (100).
  - Holographic and Starter sets are shown for information only; ownership can't be verified from the Web App, so syncing and buying are disabled for them.
- **After buying:** by default the card is **relisted**. The sale price can be the paid or the fut.gg price, adjusted by ±20%, with a chosen listing duration. The card still counts as collected, so the real cost is ≈ the 5% tax. You can also keep the card in the transfer list or in unassigned.
- **Grading in-game:** the Web App can't grade sets. Sets you bought cards for, and sets where you own every solution card, get a "grade in game" badge. After grading, remove the mark with **✓ I graded it** in the detail view.
- **Token planner:** enter a token target (Hall of FUT: 300 / 400 / 500 David Luiz / 750 Pato–Hulk) or a coin budget. It finds the cheapest plan picking at most one grade per set; **Buy plan** buys the sets one after another.
- **Sort / filter, Coins ↻, market badge:** cards already in your gallery get a "✓ Galeride" badge on the market (Turkish only).
- **Catalog:** `data/gallery-sets.json` is built from fut.gg by `tools/build-gallery-sets.mjs`. GitHub Actions rebuilds it **every day at 18:00 UTC**. The extension fetches the new version on the first launch after 18:40 UTC; if the download fails it retries an hour later, and without a network it uses the bundled copy. A warning appears in the detail view if a set's prices are older than 2 days.

**Known limit:** the grade and score shown here don't include in-game **bonus tags** (same club, first owner +500%, etc.), so the in-game grade can be higher. fut.gg solutions are calculated with bonuses, so a solution reaches its grade in-game even when "Score (solution / target)" looks below the target.

</details>

<details>
<summary><b>Player list screen (legacy feature, Turkish only)</b></summary>

Buys **1 card from the cheapest BIN listing** of every player on the list, whatever the version:

- Player search and bulk add from `players.json`
- Face / crest / flag to tell players apart, plus a "different club" warning
- Price and club scan
- Budget
- Error protocol: stops on captcha, 429, 471, 494, soft ban or session errors

Open it with the "Player list" link at the top right of the Gallery screen.

</details>

<details>
<summary><b>Development</b></summary>

- `node --test tests/*.test.mjs`: tests for the calculations, the language dictionary and that the userscript is up to date.
- `node tools/build-userscript.mjs`: regenerates the embedded block in the userscript after `lib/i18n.js` or `lib/gallery.js` changes. CI checks this.
- `node tools/build-gallery-sets.mjs`: builds the catalog from fut.gg. It logs a warning for unknown categories or new sets, and doesn't write the file if most solutions can't be read.

</details>

<details>
<summary><b>File layout</b></summary>

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (Chrome extension) |
| `inject.js` | Page context: captures the session from UT requests, adds the market badge |
| `content.js` / `content.css` | Stores the session (origin-checked), keepalive, left-menu tab and embedded panel |
| `background.js` | Tasks: syncing, live prices, buying (price cap, budget, transfer list), relisting, player list |
| `gallery.html` / `gallery.js` | Gallery screen |
| `popup.html` / `popup.js` | Player list screen |
| `lib/gallery.js` | Pure calculations: score/grade, fut.gg plan, price cap, token planner, sorting |
| `lib/i18n.js` | Turkish / English dictionary |
| `lib/gallery-api.js` | Reads a set's cards through the Web App's concept search |
| `lib/ea-api.js` | UT API client (tab selection, session refresh) |
| `lib/catalog.js` | Catalog loading and daily GitHub update |
| `lib/players.js`, `lib/img.js`, `lib/pricing.js` | Player search + name dictionaries, image URLs, price steps |
| `data/gallery-sets.json` | Set catalog (126 sets, with fut.gg solutions and price dates) |
| `userscript/gallery-grab.user.js` | Tampermonkey version |
| `branding/` | Logo and GitHub social preview (with HTML sources) |
| `tools/`, `tests/`, `.github/workflows/` | Catalog/userscript builds, tests, daily catalog job and CI |

Code analysis and known limits (Turkish): [ANALIZ.md](ANALIZ.md)

</details>

## Disclaimer and legal notes

<details>
<summary>Read before using</summary>

- This project is **free and not for sale**, and is not offered commercially in any way. **Selling the code, bundling it into a paid service or subscription, or any other commercial use is prohibited by the license**; personal use, modification and sharing are allowed. The source is open under the [PolyForm Noncommercial 1.0.0](LICENSE) license: **commercial use and sale are prohibited** and **no warranty is given** ("as is").
- This project is **not affiliated with Electronic Arts Inc.** and is not endorsed, supported or sponsored by EA. "EA", "EA SPORTS", "FC", "FIFA" and "Ultimate Team" are trademarks of their owners and are mentioned here only for identification. The repository contains no EA images, sounds, code or data. While running, the script only reads data your browser has already downloaded.
- **Automating actions on the EA Web App is against EA's terms of service.** Using it may lead to account restrictions, removal of in-game items or a permanent ban. If you don't accept this risk, don't use it.
- The software is shared **for educational and personal experimentation purposes**. All consequences of using it (account sanctions, coin loss, data loss included) are **entirely the user's responsibility**; the developer accepts no liability.
- No security measure, payment system or protection mechanism is bypassed; the script uses the user's own session in the user's own browser. It must not be used for account selling, coin trading or acting on behalf of third parties.
- The set catalog (thresholds, rewards, suggested solutions) is compiled daily from public [fut.gg](https://www.fut.gg/fut-gallery/) pages; the project is not affiliated with fut.gg either.
- If a rights holder asks for removal, the repository will be taken down. Just write to the address in the [Contact](#contact) section.

</details>
