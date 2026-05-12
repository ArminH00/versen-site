const { getProfileByEmail, getProfileById, isSupabaseConfigured, upsertProfile } = require('./supabase');

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET || '';
}

function anonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || serviceRoleKey();
}

function assertSupabaseAuth() {
  if (!supabaseUrl() || !serviceRoleKey()) {
    const error = new Error('Supabase Auth saknar serverkonfiguration');
    error.status = 503;
    throw error;
  }
}

async function authRequest(pathname, { admin = false, token = '', ...options } = {}) {
  assertSupabaseAuth();
  const key = admin ? serviceRoleKey() : anonKey();
  const authToken = token || key;
  const response = await fetch(`${supabaseUrl()}/auth/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    const error = new Error((data && (data.msg || data.message || data.error_description || data.error)) || 'Supabase Auth svarade med ett fel');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function createSupabaseUser({ email, password, firstName, lastName }) {
  const user = await authRequest('admin/users', {
    admin: true,
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName || '',
        last_name: lastName || '',
      },
    }),
  });

  await upsertProfile({
    id: user.id,
    email,
    first_name: firstName,
    last_name: lastName,
    membership_status: 'inactive',
  });

  return user;
}

async function signInWithPassword(email, password) {
  return authRequest('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

async function refreshSupabaseSession(refreshToken) {
  if (!refreshToken) {
    return null;
  }

  return authRequest('token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function getSupabaseUser(accessToken) {
  if (!accessToken || !isSupabaseConfigured()) {
    return null;
  }

  try {
    return await authRequest('user', {
      token: accessToken,
      method: 'GET',
    });
  } catch (error) {
    return null;
  }
}

async function updateSupabasePassword(userId, password) {
  return authRequest(`admin/users/${encodeURIComponent(userId)}`, {
    admin: true,
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

async function findSupabaseAccountByEmail(email) {
  return getProfileByEmail(email);
}

async function ensureProfileForUser(user) {
  if (!user || !user.id) {
    return null;
  }

  const existing = await getProfileById(user.id);
  if (existing) {
    return existing;
  }

  const meta = user.user_metadata || {};
  return upsertProfile({
    id: user.id,
    email: user.email,
    first_name: meta.first_name || meta.firstName || '',
    last_name: meta.last_name || meta.lastName || '',
    membership_status: 'inactive',
  });
}

module.exports = {
  createSupabaseUser,
  ensureProfileForUser,
  findSupabaseAccountByEmail,
  getSupabaseUser,
  refreshSupabaseSession,
  signInWithPassword,
  updateSupabasePassword,
};
