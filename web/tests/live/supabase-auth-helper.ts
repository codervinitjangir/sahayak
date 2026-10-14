import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://pefyozsahazextxkmhdh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_52jyLfGSh_bGPgFS_rbmCg_2HHi_MA9';
const SUPABASE_SECRET_KEY = 'sb_secret_icP8aoUXkEH4QYfWz_H0Zw_X1J0zl4R';

const adminHeaders = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
  'Content-Type': 'application/json',
};

export interface RealSupabaseIdentity {
  auth_user_id: string;
  access_token: string;
  email: string;
}

/**
 * Creates a real Supabase account, confirms email, signs in, and returns real ES256 access token.
 * This matches the exact method used by backend/tests/integration/check_user_registration.py.
 */
export async function createRealSupabaseUser(label: string, phone?: string): Promise<RealSupabaseIdentity> {
  const email = `sahayak-live-${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}@sahayak-regqa.invalid`;
  const password = `Qa!${Math.random().toString(36).substring(2)}${Date.now()}A1!`;

  const barePhone = phone ? phone.replace(/\D/g, '') : undefined;
  const userPayload: Record<string, unknown> = {
    email,
    password,
    email_confirm: true,
  };
  if (barePhone) {
    userPayload.phone = barePhone;
    userPayload.phone_confirm = true;
  }

  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(userPayload),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create Supabase user: ${createRes.status} ${text}`);
  }

  const createJson = (await createRes.json()) as { id: string };
  const auth_user_id = createJson.id;

  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Failed to sign in Supabase user: ${tokenRes.status} ${text}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token: string };
  return {
    auth_user_id,
    access_token: tokenJson.access_token,
    email,
  };
}

/**
 * Deletes real Supabase user account via Admin API.
 */
export async function deleteRealSupabaseUser(auth_user_id: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
  } catch (err) {
    console.warn(`Could not delete Supabase user ${auth_user_id}:`, err);
  }
}

/**
 * Executes the documented SQL step:
 * UPDATE partners SET verification_status = 'verified' WHERE id = partner_id;
 */
export function setPartnerVerifiedInDb(partnerId: string): void {
  const scriptPath = path.resolve(__dirname, 'db_helper.py');
  execSync(`python "${scriptPath}" verify "${partnerId}"`, { stdio: 'inherit' });
}

/**
 * Cleans up created PostgreSQL records keyed by phone numbers.
 */
export function cleanupDbRecords(phones: string[]): void {
  if (phones.length === 0) return;
  const scriptPath = path.resolve(__dirname, 'db_helper.py');
  execSync(`python "${scriptPath}" cleanup "${phones.join(',')}"`, { stdio: 'inherit' });
}
