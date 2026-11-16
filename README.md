# token-radar-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Van7art/token-radar-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Van7art/token-radar-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar: a board of the protocols whose token does not exist yet, ranked
by an implied value, with a farm plan for each one. The radar-2 model scores a 198-row board
covering all 40 protocols on the watchlist, and writes a seven-step farm plan for every row.
The result is served by a dark, static dashboard — sortable, filterable, no framework, no
network. Built for the
[make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01)
("Build the best token launch radar", $1,325 USDC).

Referral: [make.fun/r/4e96xqxt](https://make.fun/r/4e96xqxt)

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=4e96xqxt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## The model (radar-2)

`main.ts` reads the sealed DefiLlama snapshot at `/input/snapshot.json` and scores every
rankable pre-token protocol — the 40-protocol watchlist plus every other pre-token protocol the
watchlist rule would keep, above or below the $50M floor. Wrapped, staked and bridged products
of tokens that already trade are kept off the board, because they will never issue a token of
their own. Live-token protocols are set aside with their market caps shown; their
market-cap-to-TVL ratios are what the pre-token multiples are learned from.

```
multiple(cat) = median mcap/TVL of the live-token protocols in the category,
                each ratio winsorized at 1.0 first, pulled toward the
                snapshot-wide median when the category has few comparables:
                (n x cat median + 5 x global median) / (n + 5),
                winsorized at 1.0; no comparables: the global median
implied       = round(tvl_usd x multiple(cat)
                x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                x (0.6 + min(age_days, 1095) / 1095 x 0.4))
```

No protocol name is special-cased: the same function scores every row. Multipliers are rounded
to 4 decimals before the product, so the dashboard recomputes exactly the number `board.json`
carries. Each row's farm plan is seven concrete steps derived from the protocol's own record —
category, chains, TVL and age — with what each step costs and how long it takes. Gas costs come
from a per-chain table covering every chain on the board (119 chains), so no row falls back to
a flat estimate.

## The dashboard

A static page, no framework and no network: a sortable, filterable board (search, category,
watchlist-only, pre-token / live-token tabs), a detail view for every protocol with the model's
own inputs and its farm plan, and the learned multiples by category. `main.ts` writes the
board to `/output/board.json`, the page's data to `/output/data.js`, and the dossier with the
vendored make.fun library.

Node only, standard library only, plain JavaScript in a `.ts` file so the grader's pinned Node
runs it with no flags, no build and no install. Deterministic: two runs write byte-identical
output.

## Files

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out
- `lib/model.js` — the radar-2 model, the board builder and the farm plans
- `dashboard/` — the static page (index.html, app.css, app.js)
- `screenshots/` — three real renders: the board, a protocol's detail view, a filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte-identical from the kit

## License

MIT — see `LICENSE`.
