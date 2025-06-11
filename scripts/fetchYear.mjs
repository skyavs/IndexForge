import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DAYS = 365;
const BATCH_SIZE = 50;

const toYahoo = (s) => s.replace('.', '-');
const url = (s) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=${DAYS}d&interval=1d`;

const { data: comps } = await supabase
  .from('components')
  .select('symbol');

let total = 0;
for (let i = 0; i < comps.length; i += BATCH_SIZE) {
  const batch = comps.slice(i, i + BATCH_SIZE);

  const rows = (
    await Promise.all(
      batch.map(async ({ symbol }) => {
        const r = await fetch(url(toYahoo(symbol)));
        const j = await r.json();
        const c = j.chart?.result?.[0];
        if (!c) return [];
        const { timestamp, indicators } = c;
        const close = indicators.quote[0].close;
        const adj = indicators.adjclose?.[0]?.adjclose ?? [];
        return timestamp.map((t, idx) => ({
          symbol,
          trade_date: new Date(t * 1000).toISOString().slice(0, 10),
          close: close[idx],
          adj_close: adj[idx] ?? null
        }));
      })
    )
  ).flat();

  const { count } = await supabase
    .from('daily_prices')
    .upsert(rows, { onConflict: 'symbol,trade_date', count: 'exact' });
  total += count ?? 0;
  console.log(`Batch ${i/BATCH_SIZE+1}: upserted ${count}`);
}

console.log('Done, total rows:', total);
process.exit();
