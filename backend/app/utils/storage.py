"""Supabase Storage, server side only (ADR-038).

The bucket is private. Browsers and phones never hold a key: the backend signs
a one-time upload URL for one object path, and signs a 60-second view URL for
staff. Every call here uses SUPABASE_SECRET_KEY and raises StorageError on any
failure, so the service layer decides what the caller sees.
"""
from typing import Optional

import httpx

from app.config.settings import get_settings

BUCKET = "partner-documents"
VIEW_URL_TTL_S = 60


class StorageError(Exception):
    pass


def _base() -> tuple[str, dict[str, str]]:
    s = get_settings()
    if not s.SUPABASE_URL or not s.SUPABASE_SECRET_KEY:
        raise StorageError("storage is not configured")
    key = s.SUPABASE_SECRET_KEY
    return f"{s.SUPABASE_URL.rstrip('/')}/storage/v1", {"apikey": key, "Authorization": f"Bearer {key}"}


async def _call(method: str, path: str, json: Optional[dict] = None) -> httpx.Response:
    base, headers = _base()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            return await client.request(method, f"{base}{path}", headers=headers, json=json)
    except httpx.HTTPError as exc:
        raise StorageError(type(exc).__name__) from exc


async def signed_upload_url(object_path: str) -> str:
    """A URL the client PUTs the file to. Valid for one object, about two hours."""
    r = await _call("POST", f"/object/upload/sign/{BUCKET}/{object_path}", json={})
    if r.status_code != 200:
        raise StorageError(f"sign upload {r.status_code}")
    base, _ = _base()
    return f"{base}{r.json()['url']}"


async def object_info(object_path: str) -> Optional[dict]:
    """The stored object's metadata, or None if nothing was uploaded."""
    r = await _call("GET", f"/object/info/{BUCKET}/{object_path}")
    if r.status_code in (400, 404):
        return None
    if r.status_code != 200:
        raise StorageError(f"info {r.status_code}")
    return r.json()


async def signed_view_url(object_path: str) -> str:
    r = await _call("POST", f"/object/sign/{BUCKET}/{object_path}", json={"expiresIn": VIEW_URL_TTL_S})
    if r.status_code != 200:
        raise StorageError(f"sign view {r.status_code}")
    base, _ = _base()
    return f"{base}{r.json()['signedURL']}"


async def delete_objects(object_paths: list[str]) -> None:
    if not object_paths:
        return
    r = await _call("DELETE", f"/object/{BUCKET}", json={"prefixes": object_paths})
    if r.status_code != 200:
        raise StorageError(f"delete {r.status_code}")
