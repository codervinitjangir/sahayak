#!/bin/bash
cd "C:/Users/LENOVO/Desktop/Our Goool/Sahayak/backend"
PY="C:/Program Files/Python312/python.exe"
for h in check_job_race check_dispatch_race check_partner_offers check_dispatch_flow check_dispatch_capacity check_job_lifecycle check_payments_and_sharing check_ratings check_notifications; do
  echo "### $h" >> ../docs/evidence/harness-results.txt
  timeout 900 "$PY" tests/integration/$h.py > ../docs/evidence/$h.log 2>&1
  echo "exit=$?  $(grep -E '[0-9]+/[0-9]+ checks passed' ../docs/evidence/$h.log | tail -1)" >> ../docs/evidence/harness-results.txt
done
echo "### DONE" >> ../docs/evidence/harness-results.txt
