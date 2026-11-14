"""Zoom third-party closed-caption API client.

The meeting host enables "Allow use of caption API token" and copies the API token
(a URL) from the Closed Caption menu. Each caption is POSTed to
    <token URL>&seq=<n>&lang=en-US
with Content-Type text/plain; charset=utf-8. `seq` must increase by one per new
caption (and stay the same when retrying). Tokens expire when the meeting ends.
"""

from __future__ import annotations

import logging
import threading
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

logger = logging.getLogger(__name__)


class ZoomTokenError(ValueError):
    pass


def validate_token_url(url: str) -> str:
    url = url.strip()
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if p.scheme != "https" or not (host == "zoom.us" or host.endswith(".zoom.us")):
        raise ZoomTokenError("not a Zoom caption API token (expected https://….zoom.us/closedcaption?…)")
    if "closedcaption" not in p.path or "id" not in parse_qs(p.query):
        raise ZoomTokenError("token URL must point at /closedcaption with an id parameter")
    return url


class ZoomCaptionClient:
    def __init__(self, token_url: str, lang: str = "en-US", timeout: float = 5.0,
                 transport: httpx.BaseTransport | None = None):
        self.token_url = validate_token_url(token_url)
        self.lang = lang
        self._seq = 0
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=timeout, transport=transport)

    @property
    def seq(self) -> int:
        return self._seq

    def post(self, text: str, retries: int = 1) -> None:
        with self._lock:
            seq = self._seq + 1
            url = self.token_url + "&" + urlencode({"seq": seq, "lang": self.lang})
            last: Exception | None = None
            for _ in range(retries + 1):
                try:
                    r = self._client.post(url, content=text.encode("utf-8"),
                                          headers={"Content-Type": "text/plain; charset=utf-8"})
                    if r.status_code < 300:
                        self._seq = seq
                        return
                    last = RuntimeError(f"Zoom returned HTTP {r.status_code}: {r.text[:120]}")
                except httpx.HTTPError as exc:
                    last = exc
            raise RuntimeError(f"caption not delivered: {last}")

    def close(self) -> None:
        self._client.close()

    def redacted(self) -> str:
        p = urlparse(self.token_url)
        return f"{p.scheme}://{p.hostname}{p.path}?id=…"
