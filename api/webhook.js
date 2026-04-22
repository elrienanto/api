const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// helper
const mapNationality = (val) => {
  if (!val) return "WNI";

  const v = val.toUpperCase();

  if (v.includes("WNI") || v.includes("INDONESIA")) return "WNI";
  if (v.includes("WNA") || v.includes("FOREIGN")) return "WNA";

  return "WNI";
};

module.exports = async function handler(req, res) {
  try {
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
    // 1. UPSERT → always reset state
    // -----------------------------
    const { data: upsertData, error: upsertError } = await supabase
      .from('requests')
      .upsert(
        [{
          user_id: user_id,
          status: 'processing',
          error_message: null,
          gadjian_status: null,
          gadjian_response: null,
          updated_at: new Date()
        }],
        { onConflict: 'user_id' }
      )
      .select();

    if (upsertError) throw upsertError;

    // -----------------------------
    // 2. Josys Auth
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
    const josysToken = authData.id_token;

    if (!josysToken) {
      throw new Error("Josys auth failed");
    }

    // -----------------------------
    // 3. Search user
    // -----------------------------
    let foundUser = null;

    const searchBody = user_id
      ? { user_id: { operator: "equals", value: user_id } }
      : { email: { operator: "equals", value: email } };

    const searchRes = await fetch(
      'https://developer.josys.it/api/v2/user_profiles/search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${josysToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchBody)
      }
    );

    const searchData = await searchRes.json();

    if (searchData.data?.length > 0) {
      foundUser = searchData.data[0];
    }

    if (!foundUser) {
      throw new Error("User not found in Josys");
    }

    // -----------------------------
    // 4. Get user detail
    // -----------------------------
    const detailRes = await fetch(
      `https://developer.josys.it/api/v2/user_profiles/${foundUser.uuid}`,
      {
        headers: {
          Authorization: `Bearer ${josysToken}`
        }
      }
    );

    const detailData = await detailRes.json();
    const u = detailData.data;

    if (!u) {
      throw new Error("Invalid user detail response");
    }

    const getCustom = (name) =>
      u.custom_fields?.find(f => f.name === name)?.value || null;

    // -----------------------------
    // 5. UPDATE DB with latest data
    // -----------------------------
    await supabase
      .from('requests')
      .update({
        employee_id: u.uuid,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        employment_status: u.status,
        title: u.job_title,
        start_date: u.start_date,
        end_date: u.end_date,

        kewarganegaraan: mapNationality(getCustom('Kewarganegaraan')),
        tipe_identitas: getCustom('Tipe Identitas'),
        nomor_identitas: getCustom('Nomor Identitas'),
        tempat_lahir: getCustom('Tempat Lahir'),
        tanggal_lahir: getCustom('Tanggal Lahir'),
        status_wajib_pajak: getCustom('Status Wajib Pajak'),

        updated_at: new Date()
      })
      .eq('user_id', user_id);

    // -----------------------------
    // 6. Gadjian Auth
    // -----------------------------
    const gadjianAuth = await fetch(
      'https://developer.gadjian.com/v1/auth',
      {
        method: 'POST',
        headers: {
          Key: process.env.GADJIAN_KEY,
          Secret: process.env.GADJIAN_SECRET
        }
      }
    );

    const gadjianToken = gadjianAuth.headers.get('X-Access-Token');

    if (!gadjianToken) {
      throw new Error("Gadjian auth failed");
    }

    // -----------------------------
    // 7. Get NPWP
    // -----------------------------
    const npwpRes = await fetch(
      'https://developer.gadjian.com/v1/company/npwp-pemotong',
      {
        headers: {
          Authorization: `Bearer ${gadjianToken}`
        }
      }
    );

    const npwpData = await npwpRes.json();
    const npwp = npwpData.data?.[0];

    if (!npwp) {
      throw new Error("NPWP not found");
    }

    // -----------------------------
    // 8. Create employee
    // -----------------------------
    const createRes = await fetch(
      'https://developer.gadjian.com/v1/employee',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gadjianToken}`
        },
        body: JSON.stringify({
          id_personalia: user_id,
          nama: `${u.first_name} ${u.last_name}`,
          tgl_mulai_kerja: u.start_date,
          kewarganegaraan: mapNationality(getCustom('Kewarganegaraan')),
          tipe_identitas: getCustom('Tipe Identitas') || "KTP",
          nomor_identitas: getCustom('Nomor Identitas') || "",
          tempat_lahir: getCustom('Tempat Lahir') || "",
          tgl_lahir: getCustom('Tanggal Lahir') || "",
          email: u.email,
          no_npwp: "0000000000000000",
          status_pajak: getCustom('Status Wajib Pajak') || "TK0",
          id_npwp_pemotong: npwp.id_npwp_pemotong,
          id_nitku_pemotong: npwp.nitku_pemotong?.[0]?.id_nitku_pemotong
        })
      }
    );

    const gadjianResponse = await createRes.text();

    // -----------------------------
    // 9. FINAL UPDATE
    // -----------------------------
    await supabase
      .from('requests')
      .update({
        status: createRes.ok ? 'success' : 'failed',
        gadjian_status: createRes.ok ? 'success' : 'failed',
        gadjian_response: gadjianResponse,
        updated_at: new Date()
      })
      .eq('user_id', user_id);

    return res.status(200).json({
      status: 'success',
      gadjian_response: gadjianResponse
    });

  } catch (err) {
    console.error(err);

    // -----------------------------
    // ERROR UPDATE
    // -----------------------------
    if (req.body?.user_id) {
      await supabase
        .from('requests')
        .update({
          status: 'failed',
          error_message: err.message,
          updated_at: new Date()
        })
        .eq('user_id', req.body.user_id);
    }

    return res.status(500).json({
      error: err.message
    });
  }
};
