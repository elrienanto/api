import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // -----------------------------
    // 1. Get Auth Token
    // -----------------------------
    const authRes = await fetch(
      'https://developer.josys.it/api/v1/oauth/tokens',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          api_user_key: process.env.JOSYS_API_KEY,
          api_user_secret: process.env.JOSYS_API_SECRET
        })
      }
    );

    const authData = await authRes.json();
    const token = authData.access_token;

    if (!token) {
      throw new Error('Failed to get auth token');
    }

    // -----------------------------
    // 2. Get user list (page 1 for now)
    // -----------------------------
    const listRes = await fetch(
      'https://developer.josys.it/api/v2/user_profiles?per_page=100',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    const listData = await listRes.json();

    // -----------------------------
    // 3. Find matching user
    // (TEMP: match by email or uuid depending on your input)
    // -----------------------------
    const user = listData.data.find(u => u.uuid === user_id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // -----------------------------
    // 4. Get user detail
    // -----------------------------
    const detailRes = await fetch(
      `https://developer.josys.it/api/v2/user_profiles/${user.uuid}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    const detail = await detailRes.json();
    const u = detail.data;

    // -----------------------------
    // 5. Extract custom fields
    // -----------------------------
    const getCustom = (name) =>
      u.custom_fields?.find(f => f.name === name)?.value || null;

    // -----------------------------
    // 6. Insert into Supabase
    // -----------------------------
    const { error } = await supabase
      .from('requests')
      .insert([{
        employee_id: u.uuid,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        employment_status: u.status,
        title: u.job_title,
        start_date: u.start_date,
        end_date: u.end_date,
        username: u.username,
        personal_email: u.personal_email,
        location_code: u.work_location_code,
        department: u.department_uuids?.[0] || null,

        kewarganegaraan: getCustom('Kewarganegaraan'),
        tipe_identitas: getCustom('Tipe Identitas'),
        nomor_identitas: getCustom('Nomor Identitas'),
        tempat_lahir: getCustom('Tempat Lahir'),
        tanggal_lahir: getCustom('Tanggal Lahir'),
        status_wajib_pajak: getCustom('Status Wajib Pajak')
      }]);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      status: 'success',
      message: 'User synced to Supabase',
      uuid: u.uuid
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
