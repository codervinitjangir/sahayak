#!/usr/bin/env python3
"""
Sahayak Database Setup & Verification Tool
Applies schema, seeds initial data, and verifies all 15 required tables.

Usage:
    python scripts/db_setup.py --all
    python scripts/db_setup.py --schema
    python scripts/db_setup.py --seed
    python scripts/db_setup.py --verify
"""

import sys
import os
import argparse
from pathlib import Path
import psycopg2
from urllib.parse import unquote

try:
    from dotenv import load_dotenv
    # Look for .env in repo root or current directory
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    load_dotenv()
except ImportError:
    pass

EXPECTED_TABLES = [
    "admins",
    "job_assignments",
    "job_status_history",
    "jobs",
    "notifications",
    "partner_documents",
    "partner_equipment",
    "partner_services",
    "partners",
    "payments",
    "ratings",
    "service_categories",
    "services",
    "users",
    "vehicles"
]

DEFAULT_REF = "pefyozsahazextxkmhdh"
DEFAULT_PWD = "Sahayak123@88"

def get_connection(conn_str=None, project_ref=None, password=None):
    try:
        if conn_str:
            conn = psycopg2.connect(conn_str, connect_timeout=15)
        else:
            ref = project_ref or os.getenv("SUPABASE_PROJECT_REF") or DEFAULT_REF
            pwd = password or os.getenv("SUPABASE_DB_PASSWORD") or DEFAULT_PWD
            host = f"db.{ref}.supabase.co"
            
            print(f"[*] Connecting to {host}:5432 (database: postgres, user: postgres)...")
            conn = psycopg2.connect(
                dbname="postgres",
                user="postgres",
                password=pwd,
                host=host,
                port=5432,
                connect_timeout=15
            )
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"[-] Connection failed: {e}")
        sys.exit(1)

def run_sql_file(conn, file_path: Path):
    if not file_path.exists():
        print(f"[-] File not found: {file_path}")
        return False

    print(f"[*] Executing SQL from: {file_path.name} ...")
    with open(file_path, "r", encoding="utf-8") as f:
        sql = f.read()

    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        print(f"[+] Successfully executed {file_path.name}")
        return True
    except Exception as e:
        print(f"[-] Error executing {file_path.name}: {e}")
        return False

def verify_tables(conn):
    print("\n" + "="*55)
    print("VERIFYING DATABASE TABLES IN 'public' SCHEMA")
    print("="*55)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        rows = cur.fetchall()
        existing_tables = set(r[0] for r in rows)

    all_present = True
    print(f"{'#':<3} | {'Table Name':<28} | {'Status':<15}")
    print("-" * 55)
    for idx, t in enumerate(sorted(EXPECTED_TABLES), 1):
        if t in existing_tables:
            print(f"{idx:<3} | {t:<28} | [FOUND]")
        else:
            print(f"{idx:<3} | {t:<28} | [MISSING]")
            all_present = False

    extra_tables = existing_tables - set(EXPECTED_TABLES)
    if extra_tables:
        print("\nAdditional tables found in public schema:")
        for t in sorted(extra_tables):
            print(f"  - {t}")

    print("-" * 55)
    total_found = len([t for t in EXPECTED_TABLES if t in existing_tables])
    print(f"Result: {total_found} of {len(EXPECTED_TABLES)} required tables verified.")

    if all_present:
        print("[SUCCESS] ALL 15 REQUIRED TABLES ARE PRESENT AND VERIFIED!\n")
        
        # Verify seed counts
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM service_categories;")
            cat_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM services;")
            srv_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM admins;")
            adm_count = cur.fetchone()[0]
            print(f"Seed Data Status:")
            print(f"  - Service Categories: {cat_count} rows")
            print(f"  - Services:           {srv_count} rows")
            print(f"  - Admins:             {adm_count} rows\n")
        return True
    else:
        print("[FAIL] Some tables are missing.\n")
        return False

def main():
    parser = argparse.ArgumentParser(description="Sahayak Database Migration & Verification")
    parser.add_argument("--conn", help="PostgreSQL connection string URI")
    parser.add_argument("--project-ref", help="Supabase Project Reference")
    parser.add_argument("--password", help="Supabase Database Password")
    parser.add_argument("--schema", action="store_true", help="Execute db/schema.sql")
    parser.add_argument("--seed", action="store_true", help="Execute db/seed.sql")
    parser.add_argument("--verify", action="store_true", help="Verify tables in database")
    parser.add_argument("--all", action="store_true", help="Run schema, seed, and verify")
    
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    schema_path = repo_root / "db" / "schema.sql"
    seed_path = repo_root / "db" / "seed.sql"

    conn = get_connection(
        conn_str=args.conn or os.getenv("DATABASE_URL"),
        project_ref=args.project_ref,
        password=args.password
    )
    print(f"[+] Connected to Supabase PostgreSQL successfully!\n")

    # If no specific action specified, run --all by default
    do_all = args.all or (not args.schema and not args.seed and not args.verify)

    if do_all or args.schema:
        run_sql_file(conn, schema_path)

    if do_all or args.seed:
        run_sql_file(conn, seed_path)

    if do_all or args.verify:
        verify_tables(conn)

    conn.close()

if __name__ == "__main__":
    main()
