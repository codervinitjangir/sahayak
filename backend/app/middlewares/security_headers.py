"""Response headers every API answer carries (launch-readiness pass, 2026-11-21).

The API serves JSON to two native apps and one web app, so most browser
protections are cheap to turn on and break nothing:

* ``X-Content-Type-Options: nosniff``: a JSON body is never run as a script.
* ``X-Frame-Options: DENY``: no API page (the docs) can be framed.
* ``Referrer-Policy: no-referrer``: share-link tokens in a URL never leak onward.
* ``Strict-Transport-Security``: only when the request arrived over HTTPS
  (Render terminates TLS and sets X-Forwarded-Proto), so local HTTP is unaffected.

No Content-Security-Policy: the JSON responses do not need one, and a strict
one would break the Swagger page.
"""
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_STATIC = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
]
_HSTS = (b"strict-transport-security", b"max-age=31536000")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        https = scope.get("scheme") == "https" or headers.get(b"x-forwarded-proto", b"") == b"https"

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                extra = [h for h in _STATIC if h[0] not in existing]
                if https and _HSTS[0] not in existing:
                    extra.append(_HSTS)
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        await self.app(scope, receive, send_with_headers)
