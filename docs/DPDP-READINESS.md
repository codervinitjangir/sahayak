# DPDP readiness: notice, retention, breach runbook (2026-11-21)

India's Digital Personal Data Protection Act 2023 and the DPDP Rules 2025 (notified 13 November
2025). Most duties of a Data Fiduciary (notice, security safeguards, breach intimation,
retention, rights) apply **18 months after notification, about 13 May 2027**. This page records
what Sahayak already does, what is left, and what to do on a breach. **Not legal advice:** have a
lawyer confirm it before relying on it (R3).

## 1. Where Sahayak stands

| Duty | State | Where |
|---|---|---|
| Itemised notice: each item of data and its purpose, plain language (rule 3) | **Drafted 2026-11-21** | `/privacy` table, `PRIVACY_ITEMS` in `web/src/pages/legal/LegalPage.tsx` |
| Consent given before processing, as easy to withdraw as to give | Sign-in screen links Terms and Privacy; withdrawal = delete the account yourself | `/login`, `/delete-account` |
| Right of access | Owner and partner export (JSON) | `GET /users/me/export`, `GET /partners/me/export` |
| Right to correction | Name and email editable; the rest by email | `PATCH /users/me`, `PATCH /partners/me` |
| Right to erasure | Self-service for both roles; the anonymised job record is kept (section 2) | ADR-025, ADR-045 |
| Grievance redressal | Officer section in Terms and Privacy; the **name is still a placeholder** (R1) | `/terms` |
| Nomination | By email only | `/privacy` |
| Security safeguards | TLS, private storage bucket with signed links, role-gated staff access, append-only audit log, staff document and photo views logged, security headers (ADR-046) | |
| Logs kept at least one year (rules 6 and 8, as summarised by law firms; check the gazette text for the exact sub-rule) | **Gap.** Application logs live on Render with Render's rotation; the audit log is in Postgres and kept | Ship logs to a store with one-year retention before May 2027 |
| Breach intimation (rule 7) | **Runbook below**; never drilled | Section 3 |
| Children's data (verifiable parental consent) | Not collected by design. Terms say users must be 18 or older (2026-11-21) | `/terms` |
| Data processors (Supabase, Render, Expo push) | Not written down | List them in Privacy; check each provider's data processing agreement |

## 2. Retention schedule

| Data | Kept | Then |
|---|---|---|
| Owner or partner profile | While the account exists | Anonymised on deletion (ADR-025, ADR-045) |
| Job, assignments, status history, payments, rating scores | Kept, without the person's details after deletion | **Decide a period** with the CA (tax and dispute limits), then add a sweep |
| Free text (pickup address, notes, rating comments) | With the job | Erased on account deletion |
| Partner documents | While a partner | 90 days after a rejection (ADR-038); immediately on account deletion (ADR-045) |
| Abandoned document uploads | 1 day | Deleted by the hourly sweep |
| Tow photos | With the job | Same decision as job records |
| Live partner position (Redis) | Latest only | Overwritten; removed on deletion |
| Notifications, push tokens | Until deletion or sign-out | Deleted with the account |
| Admin audit log | Kept (append-only) | Keep at least a year |
| Application logs and error reports | Render's rotation | **Gap**: one-year store |

## 3. Breach runbook

A **personal data breach** is any unauthorised processing, sharing, loss of access, change or
destruction of personal data. That includes a leaked key, a public bucket, a staff account used
by someone else, or a lost laptop with a database dump.

**First hour**
1. Whoever notices tells the founder or the on-call engineer at once (staff channel, phone).
2. **Contain:** rotate the key that leaked (Supabase secret key, `SHARE_LINK_SECRET`, database
   password); revoke the staff invite or suspend the staff row; make the bucket private; take the
   affected endpoint down if needed (`DISPATCH_WORKER_ENABLED=false` stops background work).
3. **Preserve evidence:** copy Render logs and the `admin_audit_log` rows for the window. Do not
   delete anything.

**Within the day**
4. Work out what data, whose, from when to when, and how (logs, audit log, Supabase auth logs).
5. **Tell the Data Protection Board without delay** (initial intimation): what happened, when,
   the likely impact.
6. **Tell every affected person without delay** through their registered contact: what happened,
   what data, the likely consequences, what we did, what they should do (for example, beware of
   calls claiming to be Sahayak), and who to contact.

**Within 72 hours of becoming aware**
7. Send the Board the **detailed report**: facts, cause, people affected, what was done to limit
   it, steps to stop it happening again, and confirmation that people were told. The Board can
   allow more time if asked in writing.

**After**
8. Write a blameless post-mortem in `docs/incidents/`, add a test or harness check that would
   have caught it, and drill this runbook once a year.

## 4. To do before May 2027

- [ ] Lawyer review of `/privacy`, `/terms`, `/delete-account` and this page (R3)
- [ ] Name the grievance officer (R1)
- [ ] Decide the retention period for job records with the CA; add a sweep
- [ ] One-year log retention (a log drain from Render to a store with a retention policy)
- [ ] List the processors (Supabase, Render, Expo, Google Play services) in `/privacy`
- [ ] One breach drill

Sources: [Bar & Bench: MeitY notifies final DPDP Rules 2025](https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025),
[YourStory: rollout over 18 months](https://yourstory.com/2025/11/digital-personal-data-protection-dpdp-rules-2025-rollout-over-18-months),
[Taxmann: breach intimation under rule 7](https://www.taxmann.com/post/blog/personal-data-breach-intimation-rule-7-dpdp),
[The Leaflet: a detailed reading](https://theleaflet.in/amp/story/explainer/indias-new-digital-personal-data-protection-rules-2025-a-detailed-reading),
[Khaitan & Co ERGO, 15 November 2025](https://www.khaitanco.com/sites/default/files/2025-11/ERGO%20-%20Digital%20Personal%20%20Data%20Protection%20Rules%20-%2015%20November%202025.pdf).
