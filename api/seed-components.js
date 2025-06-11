// api/seed-components.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CSV =
  'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // 1) скачиваем свежий список
  const text = await (await fetch(CSV)).text();
  const current = text
    .trim()
    .split('\n')
    .slice(1)
    .map((r) => {
      const [symbol, name] = r.replace(/"/g, '').split(',');
      return { symbol, name, is_active: true };
    });

  // 2) upsert новых / изменённых
  const { error: upErr, count: upCnt } = await supabase
    .from('components')
    .upsert(current, { onConflict: 'symbol', count: 'exact' });

  if (upErr) return res.status(500).json(upErr);

  // 3) деактивируем тикеры, которых больше нет
  const symbols = current.map((r) => r.symbol);
  const { error: deErr, count: deCnt } = await supabase
    .from('components')
    .update({ is_active: false })
    .not('symbol', 'in', `(${symbols.join(',')})`)
    .neq('is_active', false); // не трогаем уже неактивных

  if (deErr) return res.status(500).json(deErr);

  console.log(
    `Components updated: upserted=${upCnt}, deactivated=${deCnt}`
  );
  res.json({ upserted: upCnt, deactivated: deCnt });
}
