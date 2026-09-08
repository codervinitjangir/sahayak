#!/usr/bin/env python3
"""
Seed demo data for local development and staging.

Usage:
    python scripts/seed_demo_data.py

Requires DATABASE_URL environment variable.
"""

import os
import sys

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is not set.")
    sys.exit(1)

print("=== Sahayak Demo Data Seeder ===")
print(f"Target: {DATABASE_URL.split('@')[-1]}")  # Don't print credentials

# TODO: Implement seeding logic
# 1. Seed service categories (tyre, tow, fuel, repair)
# 2. Seed services with requires_vehicle_equipment flags
# 3. Create demo verified partners with locations in Bengaluru
# 4. Create demo owner account
# Steps above should use SQLAlchemy async sessions

print("Seeder scaffold — implement seeding logic here.")
print("Ensure all demo data is synthetic (no real PII).")
