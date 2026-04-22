import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // insert into database
  const { error } = await supabase
    .from('requests')
    .insert([{ user_id }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    status: 'stored',
    user_id
  });
}
