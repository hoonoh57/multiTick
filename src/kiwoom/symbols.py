"""종목코드 매핑 — data/stockcode/stockcode.txt 를 읽는다.

파일 형식 (앞뒤 따옴표·공백은 무시):
    # code, name
    '451060', '1Q 200액티브'
    '060310', '3S'
"""
import re
import threading
from .. import config

_lock = threading.Lock()
_cache = {"mtime": None, "rows": [], "byname": {}, "bycode": {}, "dups": {}}

LINE_RE = re.compile(r"""^\s*['"]?\s*([0-9A-Za-z]{6})\s*['"]?\s*,\s*['"]?(.*?)['"]?\s*$""")


def norm_name(s: str) -> str:
    """공백 제거 + 대문자화. 1516 표기와 파일 표기의 사소한 차이를 흡수."""
    return re.sub(r"\s+", "", str(s or "")).upper()


def _parse(text: str):
    rows, byname, bycode, dups = [], {}, {}, {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        m = LINE_RE.match(line)
        if not m:
            if "," in line:                      # 따옴표 없는 변형 허용
                a, _, b = line.partition(",")
                code, name = a.strip().strip("'\""), b.strip().strip("'\"")
            else:
                continue
        else:
            code, name = m.group(1), m.group(2)

        code, name = code.strip().upper(), name.strip()
        if len(code) != 6 or not name:
            continue

        rows.append({"code": code, "name": name})
        bycode[code] = name
        k = norm_name(name)
        if k in byname and byname[k] != code:
            dups.setdefault(k, [byname[k]]).append(code)
        else:
            byname[k] = code
    return rows, byname, bycode, dups


def load(force: bool = False):
    fp = config.STOCKCODE_FILE
    if not fp.exists():
        raise FileNotFoundError(f"종목코드 파일이 없습니다: {fp}")

    mt = fp.stat().st_mtime
    with _lock:
        if force or _cache["mtime"] != mt:
            text = fp.read_text(encoding="utf-8", errors="replace")
            if text and text[0] == "\ufeff":
                text = text[1:]
            rows, byname, bycode, dups = _parse(text)
            if not rows:
                raise ValueError(f"종목코드를 한 건도 읽지 못했습니다: {fp}")
            _cache.update(mtime=mt, rows=rows, byname=byname, bycode=bycode, dups=dups)
        return _cache


def name_to_code(force: bool = False) -> dict:
    return load(force)["byname"]


def code_to_name(force: bool = False) -> dict:
    return load(force)["bycode"]


def find(code_or_name: str):
    c = load()
    s = str(code_or_name).strip()
    if s.upper() in c["bycode"]:
        return {"code": s.upper(), "name": c["bycode"][s.upper()]}
    code = c["byname"].get(norm_name(s))
    return {"code": code, "name": c["bycode"].get(code)} if code else None


def info() -> dict:
    c = load()
    return {
        "file": str(config.STOCKCODE_FILE),
        "count": len(c["rows"]),
        "duplicateNames": {k: v for k, v in list(c["dups"].items())[:20]},
        "duplicateCount": len(c["dups"]),
    }
