import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    // -----------------------------
    // 0. Validate request
    // -----------------------------
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // -----------------------------
    // 1. Get Auth Token (Josys)
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
          api_user_key: 431fbec66bd254f7,
          api_user_secret: d11891D41285@D68a3746A1BD7fAA7cb
        })
      }
    );

    const authData = await authRes.json();
    const token = authData.access_token;

    if (!token) {
      throw new Error('Failed to get auth token');
    }

    // -----------------------------
    // 2. Loop through users (pagination)
    // -----------------------------
    let foundUser = null;
    let page = 1;

    while (!foundUser) {
      const listRes = await fetch(
        `https://developer.josys.it/api/v2/user_profiles?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          }
        }
      );

      const listData = await listRes.json();

      if (!listData.data || listData.data.length === 0) {
        break; // no more data
      }

      // match user_id safely
      foundUser = listData.data.find(
        (u) => u.user_id && u.user_id === user_id
      );

      if (foundUser) break;

      page++;
    }

    if (!foundUser) {
      return res.status(404).json({ error: 'User not found in Josys' });
    }

    const uuid = foundUser.uuid;

    // -----------------------------
    // 3. Get user detail
    // -----------------------------
    const detailRes = await fetch(
      `https://developer.josys.it/api/v2/user_profiles/${uuid}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      }
    );

    const detailData = await detailRes.json();
    const u = detailData.data;

    // -----------------------------
    // 4. Helper for custom fields
    // -----------------------------
    const getCustom = (name) =>
      u.custom_fields?.find((f) => f.name === name)?.value || null;

    // -----------------------------
    // 5. Insert into Supabase
    // -----------------------------
    const { error } = await supabase
      .from('requests')
      .insert([
        {
          employee_id: u.uuid,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
          employment_status: u.status,
          title: u.job_title,
          start_date: u.start_date,
          end_date: u.end_date,
          memo: null,
          location_code: u.work_location_code,
          username: u.username,
          personal_email: u.personal_email,
          member_type: u.role || null,
          department: u.department_uuids?.[0] || null,

          kewarganegaraan: getCustom('Kewarganegaraan'),
          tipe_identitas: getCustom('Tipe Identitas'),
          nomor_identitas: getCustom('Nomor Identitas'),
          tempat_lahir: getCustom('Tempat Lahir'),
          tanggal_lahir: getCustom('Tanggal Lahir'),
          status_wajib_pajak: getCustom('Status Wajib Pajak')
        }
      ]);

    if (error) {
      throw error;
    }

    // -----------------------------
    // 6. Success response
    // -----------------------------
    return res.status(200).json({
      status: 'success',
      message: 'User synced successfully',
      uuid: u.uuid
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
