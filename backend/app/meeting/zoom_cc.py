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
import time
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


NEW_TOKEN_HINT = ("In Zoom click Captions (CC) → Set up manual captioner → "
                  "Copy the API token, then paste it again in SignBridge. "
                  "The token changes every time the meeting restarts.")


class CaptionError(RuntimeError):
    """A caption was not delivered. `message` is written for the person running the call."""


def explain_status(code: int) -> str:
    if code in (401, 403):
        return ("Zoom rejected the caption token (HTTP %d): it has expired, the meeting "
                "restarted, or 3rd-party captioning was turned off. " % code) + NEW_TOKEN_HINT
    if code == 404:
        return "Zoom does not recognise this caption token (HTTP 404). " + NEW_TOKEN_HINT
    if code == 400:
        return ("Zoom refused the caption (HTTP 400). Check that the meeting is running, "
                "you are not in a breakout room, and the token is current. " + NEW_TOKEN_HINT)
    if code == 429:
        return "Zoom is rate-limiting captions (HTTP 429). Wait a few seconds."
    if code >= 500:
        return f"Zoom's caption service had an error (HTTP {code}). It usually recovers; try again."
    return f"Zoom returned HTTP {code}."


class ZoomCaptionClient:
    def __init__(self, token_url: str, lang: str = "en-US", timeout: float = 5.0,
                 transport: httpx.BaseTransport | None = None, probe_seq: bool = True):
        self.token_url = validate_token_url(token_url)
        self.lang = lang
        self._seq = 0
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=timeout, transport=transport)
        self.last_error: str | None = None
        self.last_error_at: float | None = None
        self.last_ok_at: float | None = None
        self.delivered = 0
        if probe_seq:
            self._seq = self._fetch_last_seq()

    def _fetch_last_seq(self) -> int:
        """Continue after Zoom's last sequence number (e.g. after SignBridge restarted
        within the same meeting). Best effort: 0 when Zoom doesn't answer."""
        p = urlparse(self.token_url)
        url = self.token_url.replace(p.path, p.path.rstrip("/") + "/seq", 1)
        try:
            r = self._client.get(url)
            if r.status_code < 300 and r.text.strip().isdigit():
                return int(r.text.strip())
        except httpx.HTTPError:
            pass
        return 0

    @property
    def seq(self) -> int:
        return self._seq

    def post(self, text: str, retries: int = 1) -> None:
        with self._lock:
            seq = self._seq + 1
            url = self.token_url + "&" + urlencode({"seq": seq, "lang": self.lang})
            msg = "caption not delivered"
            for _ in range(retries + 1):
                try:
                    r = self._client.post(url, content=text.encode("utf-8"),
                                          headers={"Content-Type": "text/plain; charset=utf-8"})
                    if r.status_code < 300:
                        self._seq = seq
                        self.delivered += 1
                        self.last_ok_at = time.time()
                        self.last_error = None
                        return
                    msg = explain_status(r.status_code)
                    if r.status_code in (400, 401, 403, 404):
                        break  # retrying the same request will not help
                except httpx.TimeoutException:
                    msg = "Zoom did not answer in time (network slow or offline)."
                except httpx.HTTPError as exc:
                    msg = f"Could not reach Zoom ({type(exc).__name__}). Check the internet connection."
            self.last_error = msg
            self.last_error_at = time.time()
            raise CaptionError(msg)

    def close(self) -> None:
        self._client.close()

    def redacted(self) -> str:
        p = urlparse(self.token_url)
        return f"{p.scheme}://{p.hostname}{p.path}?id=…"
