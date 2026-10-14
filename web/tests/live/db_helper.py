import sys
import psycopg2

DSN = "postgresql://postgres.pefyozsahazextxkmhdh:Sahayak123%4088@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

def verify_partner(partner_id: str):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE partners SET verification_status = 'verified' WHERE id = %s", (partner_id,))
    conn.close()
    print(f"VERIFIED:{partner_id}")

def cleanup_phones(phones_csv: str):
    phones = [p.strip() for p in phones_csv.split(",") if p.strip()]
    if not phones:
        return
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE phone = ANY(%s)", (phones,))
        user_ids = [row[0] for row in cur.fetchall()]
        
        cur.execute("SELECT id FROM partners WHERE phone = ANY(%s)", (phones,))
        partner_ids = [row[0] for row in cur.fetchall()]

        all_ids = user_ids + partner_ids
        if all_ids:
            cur.execute("DELETE FROM notifications WHERE recipient_id = ANY(%s::uuid[])", (all_ids,))

        if user_ids:
            cur.execute(
                """DELETE FROM ratings WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute(
                """DELETE FROM notifications WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute(
                """DELETE FROM job_status_history WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute(
                """DELETE FROM job_assignments WHERE job_id IN
                   (SELECT id FROM jobs WHERE user_id = ANY(%s::uuid[]))""", (user_ids,))
            cur.execute("DELETE FROM jobs WHERE user_id = ANY(%s::uuid[])", (user_ids,))
            cur.execute("DELETE FROM vehicles WHERE user_id = ANY(%s::uuid[])", (user_ids,))
            cur.execute("DELETE FROM users WHERE id = ANY(%s::uuid[])", (user_ids,))

        if partner_ids:
            cur.execute("DELETE FROM job_assignments WHERE partner_id = ANY(%s::uuid[])", (partner_ids,))
            cur.execute("DELETE FROM partner_services WHERE partner_id = ANY(%s::uuid[])", (partner_ids,))
            cur.execute("DELETE FROM partners WHERE id = ANY(%s::uuid[])", (partner_ids,))

        cur.execute("DELETE FROM users WHERE phone = ANY(%s)", (phones,))
        cur.execute("DELETE FROM partners WHERE phone = ANY(%s)", (phones,))
    conn.close()
    print("CLEANUP_DONE")

if __name__ == "__main__":
    action = sys.argv[1]
    if action == "verify":
        verify_partner(sys.argv[2])
    elif action == "cleanup":
        cleanup_phones(sys.argv[2])
