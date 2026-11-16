// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the radar can rank: the early rows the radar exists to find. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed
// into the ranked board. Their market caps are still the model's teacher: each category's multiple is
// learned from the live protocols in that category.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple(cat) = the median market-cap-to-TVL ratio of the live-token protocols in the category,
//                   pulled toward the snapshot-wide median when the category has few comparables:
//                   (n * catMedian + 5 * globalMedian) / (n + 5); no comparables: the global median.
//                   Each comparable's ratio is winsorized at 1.0 first: a token trading above the
//                   value locked in its protocol is the exception, and one exception must not set a
//                   whole category's multiple. The result is winsorized at 1.0 too.
//   base          = tvl_usd x multiple(cat)
//   growth        = clamp(change_7d, -60, 120) per cent
//   growthMult    = 1 + (growth / 100) x 0.5
//   maturity      = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied       = max(1, round(base x growthMult x maturity))
//
// Multipliers are rounded to 4 decimals before the product, so the dashboard recomputes exactly the
// number board.json carries. The constants are stated in the dashboard and changeable in one place.
// No protocol name is ever special-cased: the same function scores every row.

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_cap: 1.0,
  multiple_prior: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-by-value list of numbers; null when empty. */
function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf, listedAt) {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a protocol beginning with one is the exchange's own product, not a launch candidate. */
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** Categories the watchlist's own rule keeps off the list: a wrapped, staked or bridged product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and none of the watchlist rule's exclusions. */
export function isRankable(p) {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const lower = p.name.toLowerCase();
  for (const ex of EXCHANGES) {
    if (lower.startsWith(ex)) return false;
  }
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols) {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The multiples the snapshot itself teaches: one per category with live comparables, plus the global median. */
export function learnMultiples(protocols) {
  const byCategory = new Map();
  const all = [];
  for (const p of protocols) {
    if (isPreToken(p)) continue;
    if (typeof p.mcap_usd !== 'number' || p.mcap_usd <= 0) continue;
    if (typeof p.tvl_usd !== 'number' || p.tvl_usd <= 0) continue;
    // Winsorize the ratio first: a token trading above its protocol's TVL is the exception, and
    // one exception must not set a whole category's multiple.
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, 1.0);
    all.push(ratio);
    const key = p.category === null ? '' : p.category;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(ratio);
  }
  const global = median(all);
  const perCategory = {};
  for (const [cat, ratios] of byCategory) {
    const catMedian = median(ratios);
    const blended = (ratios.length * catMedian + MODEL.multiple_prior * global) / (ratios.length + MODEL.multiple_prior);
    perCategory[cat] = {
      multiple: Math.min(blended, MODEL.multiple_cap),
      comparables: ratios.length,
      category_median: catMedian,
    };
  }
  return { global, perCategory };
}

/** The multiple one category gets: its learned multiple, or the snapshot-wide median when it has none. */
export function multipleFor(category, learned) {
  const key = category === null ? '' : category;
  const entry = learned.perCategory[key];
  if (entry === undefined) return { multiple: learned.global, comparables: 0, source: 'global' };
  return { multiple: entry.multiple, comparables: entry.comparables, source: 'category' };
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(protocol, asOf, learned, model = MODEL) {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age === null ? model.unknown_age_days : age;
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const mult = multipleFor(protocol.category, learned);
  const catMult = round4(mult.multiple);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age, catMult, comparables: mult.comparables, source: mult.source };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot, model = MODEL) {
  const learned = learnMultiples(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not name, above or below
  // the floor. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, learned, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return {
    rows: scored.map((s, i) => ({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        category_multiple: s.v.catMult,
        multiple_comparables: s.v.comparables,
        multiple_source: s.v.source,
        growth_pct: s.v.growthPct,
        growth_multiplier: s.v.growthMult,
        maturity_multiplier: s.v.maturityMult,
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    })),
    learned,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step) {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p) {
  return p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

/** A typical gas price in dollars for one transaction on a chain, from the chain's own fee market. */
const GAS_USD = {
  ethereum: 8,
  solana: 0.1,
  base: 0.5,
  arbitrum: 0.5,
  optimism: 0.5,
  bsc: 0.3,
  polygon: 0.1,
  avalanche: 0.5,
  sui: 0.1,
  aptos: 0.1,
  tron: 1,
  linea: 0.5,
  blast: 0.5,
  mode: 0.1,
  mantle: 0.1,
  zksync: 0.5,
  scroll: 0.5,
  sei: 0.1,
  near: 0.1,
  ton: 0.1,
};

/** The gas line for one transaction on a chain, in dollars. */
function gasFor(chain) {
  const key = String(chain).toLowerCase().replace(/[^a-z0-9]/g, '');
  const g = GAS_USD[key];
  if (g === undefined) return 'about $3 of gas';
  if (g < 1) return 'about $' + g.toFixed(2) + ' of gas';
  return 'about $' + g + ' of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p) {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p, capital, chain) {
  const c = (p.category === null ? '' : p.category).toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
  if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  if (c.includes('staking') || c.includes('restak')) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
  if (c.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.includes('rwa')) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
  if (c.includes('basis')) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s basis vault on ' + chain + ' and hold the receipt.';
  if (c.includes('otc')) return 'Place one small trade through ' + name + ' on ' + chain + ' and keep the receipt.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p, age) {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: gas + ' for the first transaction on ' + chain,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: '$' + capital + ' of capital and ' + gas,
      time: '15 minutes to set up',
    },
    {
      text: 'Open the protocol\'s own points or rewards page and confirm this action counts toward its program; if it publishes no program, keep the position and check again monthly.',
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: gas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: 'Before you withdraw, claim only from the link the protocol itself publishes; never pay to claim and never trust a claim link from a social post or a direct message.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot) {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row) {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_comparables: row.model.multiple_comparables,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot, model = MODEL) {
  const built = buildBoard(snapshot, model);
  const board = built.rows;
  const learned = built.learned;
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug));
  const earlyBelow = early.filter((r) => r.tvl_usd < snapshot.floor_usd).length;
  const earlyAbove = early.length - earlyBelow;
  const multiples = {};
  for (const [cat, entry] of Object.entries(learned.perCategory)) {
    multiples[cat] = { multiple: round4(entry.multiple), comparables: entry.comparables };
  }
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      growth_weight: model.growth_weight,
      growth_floor: model.growth_floor,
      growth_cap: model.growth_cap,
      maturity_floor: model.maturity_floor,
      maturity_range: model.maturity_range,
      maturity_days: model.maturity_days,
      unknown_age_days: model.unknown_age_days,
      multiple_cap: model.multiple_cap,
      multiple_prior: model.multiple_prior,
      global_multiple: round4(learned.global),
      category_multiples: multiples,
    },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: snapshot.watchlist,
    board_size: board.length,
    early_size: early.length,
    early_below: earlyBelow,
    early_above: earlyAbove,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof raw.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = raw.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('snapshot.json protocol ' + i + ' is not an object');
    if (typeof v.slug !== 'string' || typeof v.name !== 'string' || typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd)) {
      throw new Error('snapshot.json protocol ' + i + ' lacks a slug, a name or a TVL');
    }
    return {
      slug: v.slug,
      name: v.name,
      category: typeof v.category === 'string' ? v.category : null,
      chains: Array.isArray(v.chains) ? v.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: typeof v.change_7d === 'number' && Number.isFinite(v.change_7d) ? v.change_7d : null,
      mcap_usd: typeof v.mcap_usd === 'number' && Number.isFinite(v.mcap_usd) ? v.mcap_usd : null,
      listed_at: typeof v.listed_at === 'string' ? v.listed_at : null,
      gecko_id: typeof v.gecko_id === 'string' ? v.gecko_id : null,
      symbol: typeof v.symbol === 'string' ? v.symbol : null,
    };
  });
  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist,
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board, snapshot) {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slugs: ' + missing.slice(0, 5).join(', ');
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0].implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return r.slug + ' has ' + steps.length + ' farm steps';
    for (const s of steps) if (s.length < 20 || s.length > 600) return r.slug + ' has a farm step of ' + s.length + ' characters';
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return r.slug + ' has implied value ' + r.implied_value_usd;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar) {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
