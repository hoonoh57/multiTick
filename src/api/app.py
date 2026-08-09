"""multiTick REST API

- 성과검증(1516) 클립보드 파싱 → 종목코드 매핑 → 워치리스트 저장
- ka10079 기준 틱캔들(30틱) 다운로드 및 캐시
- 밀도 통계 CSV 내보내기
- 정적 웹 UI 서빙
"""
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import config
from ..core import perf_verify, ticks, density
from ..kiwoom import symbols

WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="multiTick", version="1.0")


# ────────────────────────────── 요청 모델 ──────────────────────────────

class ParseReq(BaseModel):
    raw: str
    baseDate: str = ""      # 'YYYY-MM-DD'
    baseTime: str = ""      # 'HH:MM'
    condition: str = ""
    tickMul: int = 24       # 30틱 × 24 = 720틱
    bucketSec: int = 900    # 단위구간 15분
    slots: int = 20         # 구간당 슬롯 수


# ────────────────────────────── 환경 / 종목코드 ──────────────────────────────

@app.get("/api/env")
def env_info():
    """현재 접속 대상(모의/실전)과 종목코드 파일 위치 확인용."""
    return {
        "mock": config.MOCK,
        "host": config.HOST,
        "exchange": config.EXCHANGE,
        "defaultSymbol": config.DEFAULT_SYMBOL,
        "hasKey": bool(config.APPKEY and config.SECRETKEY),
        "stockcodeFile": str(config.STOCKCODE_FILE),
        "dataDir": str(config.DATA_DIR),
    }


@app.get("/api/symbols/info")
def symbols_info():
    """stockcode.txt 인식 건수와 중복 종목명 확인."""
    try:
        return symbols.info()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/symbols/refresh")
def symbols_refresh():
    """stockcode.txt 를 강제로 다시 읽는다.

    평소에는 파일 수정 시각을 감시해 자동 반영되므로 호출할 일이 없지만,
    파일을 교체한 직후 즉시 반영하고 싶을 때 사용한다.
    """
    try:
        symbols.load(force=True)
        return {"reloaded": True, **symbols.info()}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/symbols/find")
def symbols_find(q: str):
    """종목명 또는 코드로 단건 조회."""
    hit = symbols.find(q)
    if not hit:
        raise HTTPException(404, f"'{q}' 를 찾지 못했습니다")
    return hit


# ────────────────────────────── 성과검증 불러오기 ──────────────────────────────

@app.post("/api/perf/parse")
def perf_parse(req: ParseReq):
    """1516 성과검증 클립보드 텍스트를 파싱하고 종목코드를 매핑한다.

    종목코드 파일을 못 읽어도 파싱 결과는 돌려주고, warn 필드로 이유를 알린다.
    """
    try:
        parsed = perf_verify.parse_clipboard(
            req.raw,
            {
                "baseDate": req.baseDate.replace("-", ""),
                "baseTime": req.baseTime.replace(":", ""),
                "condition": req.condition,
            },
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    try:
        parsed = perf_verify.resolve_codes(parsed, symbols.name_to_code())
    except FileNotFoundError as e:
        parsed["unresolved"] = [r["name"] for r in parsed["rows"]]
        parsed["ambiguous"] = []
        parsed["warn"] = f"종목코드 파일이 없습니다: {e}"
    except Exception as e:
        parsed["unresolved"] = [r["name"] for r in parsed["rows"]]
        parsed["ambiguous"] = []
        parsed["warn"] = f"종목코드 매핑 실패: {e}"

    parsed["watchlist"] = perf_verify.to_watchlist(
        parsed,
        {"tickMul": req.tickMul, "bucketSec": req.bucketSec, "slots": req.slots},
    )
    return parsed


@app.post("/api/perf/save")
def perf_save(watchlist: dict):
    """워치리스트를 data/watchlist/ 에 JSON으로 저장."""
    if not isinstance(watchlist.get("symbols"), list):
        raise HTTPException(400, "watchlist 형식이 올바르지 않습니다.")

    date = watchlist.get("baseDate") or "nodate"
    time = watchlist.get("baseTime") or "notime"
    fp = config.LIST_DIR / f"cond_{date}_{time}.json"
    fp.write_text(json.dumps(watchlist, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": str(fp), "count": len(watchlist["symbols"])}


@app.get("/api/watchlists")
def watchlists():
    return sorted(p.name for p in config.LIST_DIR.glob("*.json"))


@app.get("/api/watchlist/{name}")
def watchlist_get(name: str):
    fp = config.LIST_DIR / Path(name).name      # 경로 탈출 방지
    if not fp.exists():
        raise HTTPException(404, f"없는 파일: {name}")
    return json.loads(fp.read_text(encoding="utf-8"))


@app.delete("/api/watchlist/{name}")
def watchlist_delete(name: str):
    fp = config.LIST_DIR / Path(name).name
    if not fp.exists():
        raise HTTPException(404, f"없는 파일: {name}")
    fp.unlink()
    return {"deleted": name}


# ────────────────────────────── 틱 데이터 ──────────────────────────────

@app.get("/api/ticks")
def get_ticks(code: str, date: str, scope: int = config.BASE_TIC_SCOPE, refresh: bool = False):
    """기준 틱캔들(기본 30틱)을 반환.

    N틱 조립과 슬롯 배치는 프론트에서 수행한다(설정 변경 시 즉시 반응해야 하므로).
    종목·일자 단위로 data/ticks/ 에 캐시되며, refresh=true 면 다시 받는다.
    """
    if len(code) != 6:
        raise HTTPException(400, f"종목코드 형식 오류: {code}")
    if len(date) != 8 or not date.isdigit():
        raise HTTPException(400, f"일자 형식 오류(YYYYMMDD): {date}")

    try:
        base = ticks.fetch_base(code, date, scope, use_cache=not refresh)
    except Exception as e:
        raise HTTPException(502, str(e))

    return {
        "code": code,
        "name": symbols.code_to_name().get(code),
        "date": date,
        "scope": scope,
        "dayOpen": base[0]["open"],
        "count": len(base),
        "candles": base,
    }


@app.get("/api/ticks/cached")
def ticks_cached():
    """캐시된 틱 파일 목록."""
    out = []
    for p in sorted(config.TICK_DIR.glob("*.json")):
        parts = p.stem.split("_")
        if len(parts) == 3:
            out.append({"code": parts[0], "date": parts[1], "scope": int(parts[2]),
                        "bytes": p.stat().st_size})
    return out


# ────────────────────────────── 밀도 통계 ──────────────────────────────

@app.get("/api/density")
def density_json(code: str, date: str, mul: int = 24, bucketSec: int = 900):
    """단위구간별 발생 개수 + 가격구간별 밀도 통계."""
    try:
        base = ticks.fetch_base(code, date)
    except Exception as e:
        raise HTTPException(502, str(e))

    candles = density.assemble(base, mul)
    open_price = base[0]["open"]
    tick_size = config.BASE_TIC_SCOPE * mul

    return {
        "code": code,
        "name": symbols.code_to_name().get(code),
        "date": date,
        "tickSize": tick_size,
        "bucketSec": bucketSec,
        "dayOpen": open_price,
        "buckets": [b for b in density.bucket_counts(candles, bucketSec) if b["count"]],
        "bands": density.band_stats(candles, open_price, tick_size),
    }


@app.get("/api/density.csv", response_class=PlainTextResponse)
def density_csv(code: str, date: str, mul: int = 24, bucketSec: int = 900):
    """엑셀에서 열어볼 수 있는 밀도 통계 CSV."""
    try:
        base = ticks.fetch_base(code, date)
    except Exception as e:
        raise HTTPException(502, str(e))

    candles = density.assemble(base, mul)
    open_price = base[0]["open"]
    tick_size = config.BASE_TIC_SCOPE * mul
    name = symbols.code_to_name().get(code, "")

    lines = [f"# {code} {name} {date} {tick_size}틱 {bucketSec // 60}분구간 시가={open_price:.0f}",
             "section,key,candles,ticks,volume,dwellSec,ticksPerMin"]

    for b in density.bucket_counts(candles, bucketSec):
        if not b["count"]:
            continue
        hh, mm = b["startSec"] // 3600, (b["startSec"] % 3600) // 60
        lines.append(f"bucket,{hh:02d}:{mm:02d},{b['count']},"
                     f"{b['count'] * tick_size},{b['volume']:.0f},,")

    for a in density.band_stats(candles, open_price, tick_size):
        hi = "inf" if a["hi"] == float("inf") else a["hi"]
        lines.append(f"band,{a['lo']}~{hi}%,{a['candles']},{a['ticks']},"
                     f"{a['volume']:.0f},{a['dwellSec']},{a['ticksPerMin'] or ''}")

    return "\n".join(lines)


# ────────────────────────────── 정적 웹 UI ──────────────────────────────

@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


# 위에서 매칭되지 않은 경로만 정적 파일로 처리 (반드시 마지막에 마운트)
app.mount("/", StaticFiles(directory=WEB), name="web")
