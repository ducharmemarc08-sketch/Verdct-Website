const { createClient } = require("@supabase/supabase-js");

function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verifies the caller's Supabase session and confirms profiles.is_admin.
// Returns { ok: true, user, admin } on success, or { ok: false, status, error } on failure.
async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }

  const admin = getAdminClient();

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid or expired session" };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile?.is_admin) {
    return { ok: false, status: 403, error: "Not an admin" };
  }

  return { ok: true, user: userData.user, admin };
}

module.exports = { requireAdmin, getAdminClient };
