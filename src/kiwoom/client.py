import time
import threading
import httpx
from .. import config
from .auth import get_token


class RateLimiter:
    """TR 호출 간 최소 간격 보장 (스레드 안전)."""

    def __init__(self, per_sec: float):
        self.interval = 1.0 / max(per_sec, 0.1)
        self.lock = threading.Lock()
        self.last = 0.0

    def wait(self):
        with self.lock:
            gap = time.monotonic() - self.last
            if gap < self.interval:
                time.sleep(self.interval - gap)
            self.last = time.monotonic()


limiter = RateLimiter(config.RATE_PER_SEC)
_client = httpx.Client(timeout=20)


def call(path: str, api_id: str, body: dict, cont_yn: str = "N", next_key: str = ""):
    """단건 TR 호출. (json, cont_yn, next_key) 반환."""
    limiter.wait()
    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": f"Bearer {get_token()}",
        "api-id": api_id,
        "cont-yn": cont_yn,
        "next-key": next_key,
    }
    url = f"{config.HOST}{path}"

    for attempt in range(3):
        r = _client.post(url, json=body, headers=headers)
        if r.status_code == 401 and attempt == 0:
            headers["authorization"] = f"Bearer {get_token(force=True)}"
            continue
        if r.status_code == 429:
            time.sleep(1.0 + attempt)
            continue
        r.raise_for_status()
        data = r.json()
        rc = str(data.get("return_code", "0"))
        if rc not in ("0", "00", ""):
            raise RuntimeError(f"{api_id} 오류 {rc}: {data.get('return_msg')}")
        return data, r.headers.get("cont-yn", "N"), r.headers.get("next-key", "")

    raise RuntimeError(f"{api_id} 호출 실패 (재시도 초과)")


def paged(path: str, api_id: str, body: dict, max_pages: int):
    """연속조회 제너레이터."""
    cont, key = "N", ""
    for _ in range(max_pages):
        data, cont, key = call(path, api_id, body, cont, key)
        yield data
        if cont != "Y" or not key:
            return
