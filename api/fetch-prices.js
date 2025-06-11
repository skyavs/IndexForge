// api/fetch-prices.js
import { createClient } from '@supabase/supabase-js';

// env vars come from Vercel
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // server-side only
);

const DAYS = 60;
const BATCH_SIZE = 50;          // keep Yahoo rate-limit happy
const Y_FINANCE = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${DAYS}d&interval=1d`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 1. pull all symbols from components
  const { data: comps, error: errComps } = await supabase
    .from('components')
    .select('symbol');

  if (errComps) return res.status(500).json(errComps);

  let insertedTotal = 0;
  for (let i = 0; i < comps.length; i += BATCH_SIZE) {
    const batch = comps.slice(i, i + BATCH_SIZE);

    // 2. fetch prices in parallel
    const priceArrays = await Promise.all(
      batch.map(async ({ symbol }) => {
        const r = await fetch(Y_FINANCE(symbol));
        const j = await r.json();
        const candles = j.chart.result?.[0];
        if (!candles) return [];
        const { timestamp, indicators } = candles;
        const closes = indicators.quote[0].close;

        return timestamp.map((t, idx) => ({
          symbol,
          trade_date: new Date(t * 1000).toISOString().slice(0, 10),
          close: closes[idx],
          adj_close: null,
        }));
      })
    );

    // flatten + filter NaNs
    const rows = priceArrays.flat().filter((r) => Number.isFinite(r.close));

    // 3. upsert into daily_prices
    const { error, count } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'symbol,trade_date', count: 'exact' });

    if (error) return res.status(500).json(error);
    insertedTotal += count || 0;
  }

  res.status(200).json({ upserted: insertedTotal });
}
