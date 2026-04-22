const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async function handler(req, res) {
  try {
    // -----------------------------
    // 0. Validate request
    // -----------------------------
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const { user_id, email } = req.body;

    if (!user_id && !email) {
      return res.status(400).json({
        error: 'user_id or email is required'
      });
    }

    console.log("START:", { user_id, email });

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
          api_user_key: process.env.JOSYS_API_KEY || "431fbec66bd254f7",
          api_user_secret: process.env.JOSYS_API_SECRET || "d11891D41285@D68a3746A1BD7fAA7cb"
        })
      }
    );

    const authText = await authRes.text();
    console.log("AUTH RAW:", authText);

    let authData = {};
    try {
      authData = JSON.parse(authText);
    } catch {
      throw new Error("Auth response not JSON");
    }

    const token = authData.id_token;

    if (!token) {
      throw new Error(`No token in response: ${authText}`);
    }

    console.log("TOKEN OK");

    // -----------------------------
    // 2. Search user (user_id first)
    // -----------------------------
    let foundUser = null;

    if (user_id) {
      const resUser = await fetch(
        'https://developer.josys.it/api/v2/user_profiles/search',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: {
              operator: "equals",
              value: user_id
            }
          })
        }
      );

      const text = await resUser.text();
      console.log("SEARCH user_id RAW:", text);

      const data = JSON.parse(text);
      if (data.data && data.data.length > 0) {
        foundUser = data.data[0];
      }
    }

    // -----------------------------
    // 3. Fallback: search by email
    // -----------------------------
    if (!foundUser && email) {
      console.log("FALLBACK EMAIL SEARCH");

      const resEmail = await fetch(
        'https://developer.josys.it/api/v2/user_profiles/search',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: {
              operator: "equals",
              value: email
            }
          })
        }
      );

      const text = await resEmail.text();
      console.log("SEARCH email RAW:", text);

      const data = JSON.parse(text);
      if (data.data && data.data.length > 0) {
        foundUser = data.data[0];
      }
    }

    // -----------------------------
    // 4. Not found
    // -----------------------------
    if (!foundUser) {
      return res.status(404).json({
        error: 'User not found via user_id or email'
      });
    }

    const uuid = foundUser.uuid;
    console.log("FOUND UUID:", uuid);

    // -----------------------------
    // 5. Get full user detail
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

    const detailText = await detailRes.text();
    console.log("DETAIL RAW:", detailText.slice(0, 300));

    const detailData = JSON.parse(detailText);

    if (!detailData.data) {
      throw new Error("Invalid detail response");
    }

    const u = detailData.data;

    // -----------------------------
    // 6. Helper (custom fields)
    // -----------------------------
    const getCustom = (name) =>
      u.custom_fields?.find(f => f.name === name)?.value || null;

    // -----------------------------
    // 7. Insert into Supabase
    // -----------------------------
    const { error } = await supabase
      .from('requests')
      .insert([
  {
    user_id: user_id, // 🔥 ADD THIS

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

    console.log("SUCCESS INSERT");

    return res.status(200).json({
      status: 'success',
      uuid
    });

  } catch (err) {
    console.error("FULL ERROR:", err);

    return res.status(500).json({
      error: err.message
    });
  }
};
