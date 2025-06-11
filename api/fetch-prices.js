// api/fetch-prices.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DAYS = 60;
const BATCH_SIZE = 50;

const toYahoo = (sym) => sym.replace('.', '-').replace('/', '-'); // BRK.A → BRK-A
const yURL = (y) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${DAYS}d&interval=1d`;

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'POST only' });

  const { data: comps, error: errComps } = await supabase
    .from('components')
    .select('symbol');

  if (errComps) return res.status(500).json(errComps);

  let insertedTotal = 0;
  const skipped = [];

  for (let i = 0; i < comps.length; i += BATCH_SIZE) {
    const batch = comps.slice(i, i + BATCH_SIZE);

    const priceArrays = await Promise.all(
      batch.map(async ({ symbol }) => {
        const yahooSym = toYahoo(symbol);
        try {
          const r = await fetch(yURL(yahooSym));
          const j = await r.json();
          const candles = j.chart?.result?.[0];
          if (!candles || !candles.timestamp) {
            skipped.push(symbol);
            return [];
          }

          const { timestamp, indicators } = candles;
          const closes = indicators.quote[0].close;
          const adjCloses =
            indicators?.adjclose?.[0]?.adjclose ?? new Array(closes.length).fill(null);

          return timestamp.map((t, idx) => ({
            symbol,
            trade_date: new Date(t * 1000).toISOString().slice(0, 10),
            close: closes[idx],
            adj_close: adjCloses[idx],
          }));
        } catch {
          skipped.push(symbol);
          return [];
        }
      })
    );

    const rows = priceArrays.flat().filter((r) => Number.isFinite(r.close));

    const { error, count } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'symbol,trade_date', count: 'exact' });

    if (error) return res.status(500).json(error);

    insertedTotal += count || 0;
  }

  console.log('Skipped symbols:', skipped.join(', '));
  res.status(200).json({ upserted: insertedTotal, skipped: skipped.length });
}
