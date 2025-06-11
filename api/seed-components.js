// api/seed-components.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // Vercel keeps this secret; safe on server
);

const CSV =
  'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const text = await (await fetch(CSV)).text();

  const rows = text
    .trim()
    .split('\n')
    .slice(1)                 // skip header
    .map(r => {
      const [symbol, name] = r.split(',');
      return { symbol: symbol.replace(/"/g, ''), name: name.replace(/"/g, '') };
    });

  const { error, count } = await supabase
    .from('components')
    .upsert(rows, { onConflict: 'symbol', count: 'exact' });

  if (error) return res.status(500).json({ error });
  res.status(200).json({ upserted: count });
}
