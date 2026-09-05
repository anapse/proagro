# Cliente HTTP read-only con métricas (TTFB, total) y cabeceras saneadas.
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

from .. import headers_safe, sha256_bytes

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

MAX_BODY = 20 * 1024 * 1024  # 20 MB tope de seguridad por respuesta


@dataclass
class Probe:
    url: str
    final_url: str
    method: str
    status: Optional[int] = None
    headers: dict = field(default_factory=dict)
    body: bytes = b""
    ttfb_ms: float = 0.0
    total_ms: float = 0.0
    error: Optional[str] = None
    truncated: bool = False

    @property
    def sha256(self):
        return sha256_bytes(self.body)

    @property
    def size(self):
        return len(self.body)

    @property
    def content_type(self):
        return (self.headers or {}).get("Content-Type", "")


_session = None


def session():
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
                      "image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "es-PE,es;q=0.9",
        })
    return _session


def get(url: str, timeout=(12, 45), allow_redirects=True) -> Probe:
    s = session()
    p = Probe(url=url, final_url=url, method="GET")
    t0 = time.perf_counter()
    try:
        resp = s.get(url, timeout=timeout, allow_redirects=allow_redirects, stream=True)
        p.ttfb_ms = resp.elapsed.total_seconds() * 1000.0
        p.status = resp.status_code
        p.final_url = resp.url
        p.headers = dict(resp.headers)
        # Lectura con tope de tamaño (stream)
        chunks = []
        total = 0
        truncated = False
        for chunk in resp.iter_content(chunk_size=65536):
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_BODY:
                truncated = True
                break
        p.body = b"".join(chunks)
        p.truncated = truncated
        p.headers = headers_safe(dict(resp.headers))
    except requests.exceptions.SSLError as e:
        p.error = f"SSL: {e}"
    except requests.exceptions.Timeout as e:
        p.error = f"TIMEOUT: {e}"
    except requests.exceptions.RequestException as e:
        p.error = f"HTTP: {e}"
    finally:
        p.total_ms = (time.perf_counter() - t0) * 1000.0
    return p


def head(url: str, timeout=(10, 20)) -> Probe:
    s = session()
    p = Probe(url=url, final_url=url, method="HEAD")
    t0 = time.perf_counter()
    try:
        resp = s.head(url, timeout=timeout, allow_redirects=True)
        p.ttfb_ms = resp.elapsed.total_seconds() * 1000.0
        p.status = resp.status_code
        p.final_url = resp.url
        p.headers = headers_safe(dict(resp.headers))
    except requests.exceptions.RequestException as e:
        p.error = f"HTTP: {e}"
    finally:
        p.total_ms = (time.perf_counter() - t0) * 1000.0
    return p
