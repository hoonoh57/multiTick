def assemble(base: list[dict], mul: int) -> list[dict]:
    """30틱 원본 → mul배 조립 (무손실)."""
    if mul <= 1:
        return [dict(c, n=1) for c in base]
    out = []
    for i in range(0, len(base), mul):
        ch = base[i:i + mul]
        out.append({
            "t": ch[-1]["t"], "d": ch[-1]["d"],
            "open": ch[0]["open"],
            "high": max(c["high"] for c in ch),
            "low": min(c["low"] for c in ch),
            "close": ch[-1]["close"],
            "volume": sum(c["volume"] for c in ch),
            "n": len(ch),
            "partial": len(ch) < mul,
        })
    return out


def _sec(hms: str) -> int:
    s = str(hms).zfill(6)
    return int(s[:2]) * 3600 + int(s[2:4]) * 60 + int(s[4:6])


def bucket_counts(candles: list[dict], bucket_sec: int,
                  start_hms: str = "090000", end_hms: str = "153000") -> list[dict]:
    """단위구간별 캔들 발생 개수."""
    s0, s1 = _sec(start_hms), _sec(end_hms)
    n = max(1, -(-(s1 - s0) // bucket_sec))
    acc = [{"bucket": b, "startSec": s0 + b * bucket_sec, "count": 0,
            "volume": 0.0, "first": None, "last": None} for b in range(n)]
    for c in candles:
        b = (_sec(c["t"]) - s0) // bucket_sec
        if not 0 <= b < n:
            continue
        a = acc[b]
        a["count"] += c.get("n", 1)
        a["volume"] += c["volume"]
        a["last"] = c["close"]
        if a["first"] is None:
            a["first"] = c["open"]
    return acc


def band_stats(candles: list[dict], open_price: float, tick_size: int,
               bands=(0, 5, 10, 20, 30)) -> list[dict]:
    """시가 대비 가격 구간별 밀도 통계."""
    edges = list(bands) + [float("inf")]
    acc = [{"lo": edges[i], "hi": edges[i + 1], "candles": 0, "ticks": 0,
            "volume": 0.0, "firstSec": None, "lastSec": None}
           for i in range(len(edges) - 1)]

    for c in candles:
        pct = (c["close"] / open_price - 1) * 100
        for a in acc:
            if a["lo"] <= pct < a["hi"]:
                a["candles"] += c.get("n", 1)
                a["ticks"] += c.get("n", 1) * tick_size
                a["volume"] += c["volume"]
                sec = _sec(c["t"])
                a["firstSec"] = sec if a["firstSec"] is None else a["firstSec"]
                a["lastSec"] = sec
                break

    for a in acc:
        dwell = 0 if a["firstSec"] is None else a["lastSec"] - a["firstSec"]
        a["dwellSec"] = dwell
        a["ticksPerMin"] = round(a["ticks"] / (dwell / 60), 1) if dwell > 0 else None
    return acc
