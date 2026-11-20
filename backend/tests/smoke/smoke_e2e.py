"""End-to-end smoke test over real HTTP (E4): one job from request to rating.

    SMOKE_API_URL=https://staging-api.example/api/v1 \\
    SMOKE_SUPABASE_URL=https://<project>.supabase.co \\
    SMOKE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \\
    SMOKE_OWNER_PHONE=+91900000090X SMOKE_PARTNER_PHONE=+91900000090Y SMOKE_OTP=123456 \
    SMOKE_PARTNER_OTP=654321 \   # optional; defaults to SMOKE_OTP
    python tests/smoke/smoke_e2e.py

What it needs, set up once per environment:
  * two Supabase *test phone numbers* with a fixed OTP (Authentication > Phone >
    Test phone numbers), so no SMS is sent;
  * the owner number registered as an owner;
  * the partner number registered, linked and **verified** by staff, offering
    the service below.
It registers nothing and verifies nobody: a smoke test that creates its own
verified partner would be testing a back door.

What it does: signs both in through Supabase exactly as the apps do, puts the
partner on duty at the pickup point, raises a request, accepts the offer, moves
through en route, the start code and completion, settles in cash, rates from
both sides, and takes the partner off duty. It leaves one completed job behind,
tagged SMOKE in its description. Run it against staging, never production.

Exit code 0 only if every step passed. No secret is printed.
"""
import os
import sys
import time

import httpx

SERVICE_CODE = os.environ.get("SMOKE_SERVICE_CODE", "battery_jumpstart")
PICKUP = (float(os.environ.get("SMOKE_LAT", "12.9720")), float(os.environ.get("SMOKE_LNG", "77.5950")))
TAG = "SMOKE automated end-to-end check"


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"FAIL  {name} is not set (see the module docstring)")
        sys.exit(2)
    return value


class Smoke:
    def __init__(self) -> None:
        self.api = env("SMOKE_API_URL").rstrip("/")
        self.supabase = env("SMOKE_SUPABASE_URL").rstrip("/")
        self.pub = env("SMOKE_SUPABASE_PUBLISHABLE_KEY")
        self.owner_phone = env("SMOKE_OWNER_PHONE")
        self.partner_phone = env("SMOKE_PARTNER_PHONE")
        self.otp = env("SMOKE_OTP")
        # Supabase test numbers can each have their own fixed OTP.
        self.partner_otp = os.environ.get("SMOKE_PARTNER_OTP", "").strip() or self.otp
        self.http = httpx.Client(timeout=30)
        self.failed = False
        self.step_no = 0

    # -- plumbing -----------------------------------------------------------
    def step(self, label: str, ok: bool, detail: str = "") -> bool:
        self.step_no += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {self.step_no:02d} {label}" + (f"  - {detail}" if detail and not ok else ""))
        if not ok:
            self.failed = True
        return ok

    def sign_in(self, phone: str, otp: str) -> str:
        headers = {"apikey": self.pub, "Content-Type": "application/json"}
        self.http.post(f"{self.supabase}/auth/v1/otp", headers=headers, json={"phone": phone})
        r = self.http.post(f"{self.supabase}/auth/v1/verify", headers=headers,
                           json={"phone": phone, "token": otp, "type": "sms"})
        token = r.json().get("access_token") if r.status_code == 200 else None
        if not token:
            print(f"FAIL  could not sign in the test number ending {phone[-4:]}: HTTP {r.status_code}")
            sys.exit(1)
        return token

    def call(self, method: str, path: str, token: str, **kw) -> httpx.Response:
        return self.http.request(method, f"{self.api}{path}",
                                 headers={"Authorization": f"Bearer {token}"}, **kw)

    @staticmethod
    def data(r: httpx.Response):
        try:
            return r.json().get("data")
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def why(r: httpx.Response) -> str:
        return f"HTTP {r.status_code} {r.text[:200]}"

    # -- the run ------------------------------------------------------------
    def run(self) -> int:
        print(f"smoke test against {self.api}")
        health = self.http.get(self.api.rsplit("/api/", 1)[0] + "/health")
        self.step("API is up and reaches its database",
                  health.status_code == 200 and (self.data(health) or {}).get("database") == "connected",
                  self.why(health))

        owner = self.sign_in(self.owner_phone, self.otp)
        partner = self.sign_in(self.partner_phone, self.partner_otp)

        r = self.call("GET", "/auth/me", owner)
        if not self.step("owner number resolves to an owner", r.status_code == 200 and self.data(r)["role"] == "user", self.why(r)):
            return 1
        r = self.call("GET", "/auth/me", partner)
        if not self.step("partner number resolves to a partner", r.status_code == 200 and self.data(r)["role"] == "partner", self.why(r)):
            return 1
        partner_id = self.data(r)["id"]

        r = self.call("GET", "/vehicles", owner)
        vehicles = self.data(r) or []
        vehicles = vehicles.get("items", vehicles) if isinstance(vehicles, dict) else vehicles
        if not vehicles:
            r = self.call("POST", "/vehicles", owner, json={
                "vehicle_type": "four_wheeler", "make": "Smoke", "model": "Test", "vehicle_number": "KA01SM0001"})
            vehicles = [self.data(r)] if r.status_code == 201 else []
        if not self.step("owner has a vehicle", bool(vehicles), self.why(r)):
            return 1
        vehicle_id = vehicles[0]["id"]

        r = self.call("PATCH", f"/partners/{partner_id}/availability", partner, json={"is_available": True})
        self.step("partner goes on duty", r.status_code == 200, self.why(r))
        r = self.call("POST", f"/partners/{partner_id}/location", partner, json={"lat": PICKUP[0], "lng": PICKUP[1]})
        self.step("partner reports a location at the pickup point", r.status_code in (200, 201), self.why(r))

        try:
            return self.job_flow(owner, partner, vehicle_id)
        finally:
            r = self.call("PATCH", f"/partners/{partner_id}/availability", partner, json={"is_available": False})
            self.step("partner goes off duty again", r.status_code == 200, self.why(r))

    def job_flow(self, owner: str, partner: str, vehicle_id: str) -> int:
        r = self.call("POST", "/jobs", owner, json={
            "vehicle_id": vehicle_id, "service_code": SERVICE_CODE,
            "pickup_lat": PICKUP[0], "pickup_lng": PICKUP[1],
            "pickup_address_text": "Smoke test pickup", "issue_description": TAG,
        })
        job = self.data(r) or {}
        if not self.step("owner raises a request", r.status_code == 201 and bool(job.get("id")), self.why(r)):
            return 1
        job_id = job["id"]
        try:
            return self.after_create(owner, partner, job_id)
        finally:
            # Never leave a live request behind if a later step failed.
            state = (self.data(self.call("GET", f"/jobs/{job_id}", owner)) or {}).get("status")
            if state not in ("completed", "cancelled"):
                self.call("POST", f"/jobs/{job_id}/cancel", owner, json={"reason": "smoke test did not finish"})
                print(f"        (cancelled the unfinished smoke job {job_id[:8]}, it was {state})")

    def after_create(self, owner: str, partner: str, job_id: str) -> int:
        offer = None
        for _ in range(10):
            offers = self.data(self.call("GET", "/partners/me/offers", partner)) or []
            offer = next((o for o in offers if o.get("job_id") == job_id), None)
            if offer:
                break
            time.sleep(1)
        if not self.step("dispatch offered the job to the test partner", offer is not None,
                         "no offer for this job; is the partner verified, on duty and offering the service?"):
            return 1

        r = self.call("GET", f"/jobs/{job_id}", owner)
        d = self.data(r) or {}
        self.step("owner sees no partner details before the partner accepts (ADR-017)",
                  not (d.get("current_assignment") or {}).get("partner_phone"), "partner phone was present")

        r = self.call("POST", f"/job-assignments/{offer['assignment_id']}/respond", partner, json={"action": "accept"})
        if not self.step("partner accepts", r.status_code == 200, self.why(r)):
            return 1

        d = self.data(self.call("GET", f"/jobs/{job_id}", owner)) or {}
        code = d.get("start_code")
        self.step("owner now sees the job assigned, the partner, and a start code",
                  d.get("status") == "assigned" and bool((d.get("current_assignment") or {}).get("partner_name")) and bool(code),
                  f"status={d.get('status')}")

        r = self.call("POST", f"/jobs/{job_id}/status", partner, json={"status": "partner_en_route"})
        self.step("partner sets en route", r.status_code == 200, self.why(r))
        wrong = "0000" if code != "0000" else "1111"
        r = self.call("POST", f"/jobs/{job_id}/start", partner, json={"start_code": wrong})
        self.step("a wrong start code is refused", r.status_code in (400, 403, 409, 422), self.why(r))
        r = self.call("POST", f"/jobs/{job_id}/start", partner, json={"start_code": code or ""})
        if not self.step("the right start code starts the work", r.status_code == 200, self.why(r)):
            return 1

        price = str(d.get("price_estimate") or "499")
        r = self.call("POST", f"/jobs/{job_id}/status", partner, json={"status": "completed", "price_final": price})
        if not self.step("partner completes with a final price", r.status_code == 200, self.why(r)):
            return 1

        r = self.call("POST", "/payments", owner, json={"job_id": job_id, "payment_method": "cash"})
        payment = self.data(r) or {}
        self.step("a cash payment is recorded for the server's amount", r.status_code in (200, 201) and bool(payment.get("id")), self.why(r))
        if payment.get("id"):
            r = self.call("POST", f"/payments/{payment['id']}/confirm", owner, json={})
            self.step("the owner cannot confirm their own payment (ADR-022)", r.status_code in (403, 404), self.why(r))
            r = self.call("POST", f"/payments/{payment['id']}/confirm", partner, json={})
            self.step("the partner confirms receipt", r.status_code == 200, self.why(r))

        r = self.call("POST", f"/jobs/{job_id}/ratings", owner, json={"rating": 5, "comment": "smoke"})
        self.step("owner rates the partner", r.status_code in (200, 201), self.why(r))
        r = self.call("POST", f"/jobs/{job_id}/ratings", partner, json={"rating": 5})
        self.step("partner rates the owner", r.status_code in (200, 201), self.why(r))

        d = self.data(self.call("GET", f"/jobs/{job_id}", owner)) or {}
        self.step("the job ends completed", d.get("status") == "completed", f"status={d.get('status')}")
        return 1 if self.failed else 0


if __name__ == "__main__":
    smoke = Smoke()
    code = smoke.run()
    print("SMOKE PASSED" if code == 0 and not smoke.failed else "SMOKE FAILED")
    sys.exit(0 if code == 0 and not smoke.failed else 1)
