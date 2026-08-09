import time
import threading
import httpx
from .. import config

_lock = threading.Lock()
_token = {"value": None, "exp": 0.0}


def _parse_exp(data: dict) -> float:
    raw = str(data.get("expires_dt") or "")
    if len(raw) == 14:
        try:
            t = time.mktime(time.strptime(raw, "%Y%m%d%H%M%S"))
            return t - 120
        except ValueError:
            pass
    return time.time() + 6 * 3600


def get_token(force: bool = False) -> str:
    with _lock:
        if not force and _token["value"] and time.time() < _token["exp"]:
            return _token["value"]

        if not config.APPKEY or not config.SECRETKEY:
            raise RuntimeError(".env 에 KIWOOM_APPKEY / KIWOOM_SECRETKEY 를 설정하세요.")

        r = httpx.post(
            f"{config.HOST}/oauth2/token",
            json={
                "grant_type": "client_credentials",
                "appkey": config.APPKEY,
                "secretkey": config.SECRETKEY,
            },
            headers={"Content-Type": "application/json;charset=UTF-8"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        tok = data.get("token") or data.get("access_token")
        if not tok:
            raise RuntimeError(f"토큰 발급 실패: {data}")

        _token["value"] = tok
        _token["exp"] = _parse_exp(data)
        return tok
