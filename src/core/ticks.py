import json
from .. import config
from ..kiwoom.client import paged

CHART_PATH = "/api/dostk/chart"


def _f(v):
    """부호가 붙어 오는 가격 필드 정규화."""
    s = str(v or "").strip().replace(",", "").replace("+", "")
    if not s or s == "-":
        return None
    try:
        return abs(float(s))
    except ValueError:
        return None


def _cache_file(code: str, date: str, scope: int):
    return config.TICK_DIR / f"{code}_{date}_{scope}.json"


def fetch_base(code: str, date: str, scope: int = config.BASE_TIC_SCOPE,
               use_cache: bool = True, progress=None) -> list[dict]:
    """지정 일자의 기준 틱캔들(기본 30틱)을 시간 오름차순으로 반환."""
    fp = _cache_file(code, date, scope)
    if use_cache and fp.exists():
        return json.loads(fp.read_text(encoding="utf-8"))

    body = {"stk_cd": code, "tic_scope": str(scope), "upd_stkpc_tp": "1"}
    bucket, pages, reached = {}, 0, False

    for data in paged(CHART_PATH, "ka10079", body, config.MAX_TICK_PAGES):
        pages += 1
        rows = data.get("stk_tic_chart_qry") or []
        if not rows:
            break

        oldest = None
        for it in rows:
            tm = str(it.get("cntr_tm") or "")
            if len(tm) < 14:
                continue
            d, hms = tm[:8], tm[8:14]
            oldest = d if oldest is None else min(oldest, d)
            if d != date:
                continue
            c = _f(it.get("cur_prc"))
            o = _f(it.get("open_pric")) or c
            h = _f(it.get("high_pric")) or c
            l = _f(it.get("low_pric")) or c
            if c is None:
                continue
            bucket[tm] = {
                "t": hms, "d": d,
                "open": o, "high": h, "low": l, "close": c,
                "volume": _f(it.get("trde_qty")) or 0.0,
            }

        if progress:
            progress(pages, len(bucket), oldest)

        if oldest and oldest < date:
            reached = True
            break

    out = [bucket[k] for k in sorted(bucket)]
    if not out:
        hint = "" if reached else " (요청 페이지 한도 도달 — MAX_TICK_PAGES 를 늘려보세요)"
        raise RuntimeError(f"{code} {date} 틱 데이터가 없습니다{hint}")

    fp.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def day_open(code: str, date: str) -> float | None:
    """당일 시가. 캐시된 틱의 첫 봉 시가를 사용."""
    try:
        base = fetch_base(code, date)
        return base[0]["open"] if base else None
    except Exception:
        return None
