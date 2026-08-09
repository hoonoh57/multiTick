import re
from datetime import datetime

PERIOD_RE = re.compile(r"^(\d+)(분간|시간|일간)$")


def _clean(v):
    s = str(v or "").strip()
    if len(s) > 1 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return s.strip()


def _norm(v):
    return "".join(_clean(v).split())


def _num(v):
    s = _clean(v).replace(",", "").replace("%", "").replace(" ", "")
    if s in ("", "-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _period_sec(n, unit):
    return n * 60 if unit == "분간" else n * 3600 if unit == "시간" else n * 86400


def parse_clipboard(raw: str, meta: dict | None = None) -> dict:
    meta = meta or {}
    lines = [l for l in str(raw).replace("\r\n", "\n").replace("\r", "\n").split("\n") if l.strip()]
    if not lines:
        raise ValueError("붙여넣은 내용이 비어 있습니다.")

    h1 = next((i for i, l in enumerate(lines[:6]) if "종목명" in l), -1)
    name_i, max_i, vol_i, etc_i = 1, -1, -1, -1
    periods, start = [], 0

    if h1 >= 0:
        c1 = [_norm(x) for x in lines[h1].split("\t")]
        name_i = c1.index("종목명")
        max_i = next((i for i, v in enumerate(c1) if "최고수익률" in v), -1)
        vol_i = next((i for i, v in enumerate(c1) if "검색시점거래량" in v), -1)
        etc_i = next((i for i, v in enumerate(c1) if v == "기타"), -1)
        start = h1 + 1

        if h1 + 1 < len(lines):
            c2 = [_norm(x) for x in lines[h1 + 1].split("\t")]
            for i, v in enumerate(c2):
                m = PERIOD_RE.match(v)
                if m:
                    periods.append({"idx": i, "label": v, "sec": _period_sec(int(m.group(1)), m.group(2))})
            if periods:
                start = h1 + 2

    if not periods and max_i > name_i + 1:
        periods = [{"idx": i, "label": f"P{i - name_i}", "sec": None}
                   for i in range(name_i + 1, max_i)]

    rows, seen = [], set()
    for line in lines[start:]:
        f = line.split("\t")
        if name_i >= len(f):
            continue
        name = _clean(f[name_i])
        if not name or name == "종목명" or _norm(name) == "합계" or name in seen:
            continue
        seen.add(name)

        pick = lambda i: f[i] if 0 <= i < len(f) else None
        rows.append({
            "name": name,
            "code": None,
            "returns": {p["label"]: _num(pick(p["idx"])) for p in periods},
            "maxReturn": _num(pick(max_i)),
            "searchVolume": _num(pick(vol_i)),
            "etc": _num(pick(etc_i)),
        })

    if not rows:
        raise ValueError("종목 행을 찾지 못했습니다. 검색 종목 리스트 영역을 복사했는지 확인하세요.")

    return {
        "meta": {
            "baseDate": meta.get("baseDate", ""),
            "baseTime": meta.get("baseTime", ""),
            "condition": meta.get("condition", ""),
            "periods": [{"label": p["label"], "sec": p["sec"]} for p in periods],
            "importedAt": datetime.now().isoformat(timespec="seconds"),
            "count": len(rows),
        },
        "rows": rows,
    }


def resolve_codes(parsed: dict, mapping: dict) -> dict:
    """mapping: {정규화된_종목명: 코드}. 정확 일치 → 접두 일치 순으로 해석."""
    import re
    key = lambda s: re.sub(r"\s+", "", str(s or "")).upper()

    unresolved, ambiguous = [], []
    for r in parsed["rows"]:
        k = key(r["name"])
        code = mapping.get(k)
        r["match"] = "exact" if code else None

        if not code and len(k) >= 2:
            cand = [v for kk, v in mapping.items() if kk.startswith(k)]
            uniq = sorted(set(cand))
            if len(uniq) == 1:
                code, r["match"] = uniq[0], "prefix"
            elif len(uniq) > 1:
                ambiguous.append({"name": r["name"], "candidates": uniq[:5]})

        r["code"] = code
        if not code:
            unresolved.append(r["name"])

    parsed["unresolved"] = unresolved
    parsed["ambiguous"] = ambiguous
    return parsed



def to_watchlist(parsed: dict, opt: dict | None = None) -> dict:
    opt = opt or {}
    m = parsed["meta"]
    return {
        "schema": "multitick.watchlist/1",
        "baseDate": m["baseDate"],
        "baseTime": m["baseTime"],
        "condition": m["condition"],
        "periods": m["periods"],
        "tick": {"baseScope": 30, "mul": opt.get("tickMul", 24)},
        "bucket": {"sec": opt.get("bucketSec", 900), "slots": opt.get("slots", 20)},
        "horizonSec": opt.get("horizonSec", 3600),
        "symbols": [{
            "code": r["code"], "name": r["name"],
            "searchVolume": r["searchVolume"], "returns": r["returns"],
            "maxReturn": r["maxReturn"], "etc": r["etc"],
            "enabled": False, "dayOpen": None,
        } for r in parsed["rows"]],
    }
