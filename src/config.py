import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

_true = lambda v: str(v).strip().lower() in ("1", "true", "y", "yes", "on")

MOCK = _true(os.getenv("KIWOOM_MOCK", "true"))

APPKEY = (os.getenv("KIWOOM_MOCK_APP_KEY") if MOCK else os.getenv("KIWOOM_REAL_APP_KEY")) or ""
SECRETKEY = (os.getenv("KIWOOM_MOCK_SECRET_KEY") if MOCK else os.getenv("KIWOOM_REAL_SECRET_KEY")) or ""

HOST = "https://mockapi.kiwoom.com" if MOCK else "https://api.kiwoom.com"
EXCHANGE = os.getenv("KIWOOM_EXCHANGE", "KRX")
DEFAULT_SYMBOL = os.getenv("DEFAULT_SYMBOL", "005930")
PORT = int(os.getenv("PORT", 3010))

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = (ROOT / os.getenv("DATA_DIR", "./data")).resolve()
STOCKCODE_FILE = (ROOT / os.getenv("STOCKCODE_FILE", "./data/stockcode/stockcode.txt")).resolve()

TICK_DIR = DATA_DIR / "ticks"
LIST_DIR = DATA_DIR / "watchlist"
META_DIR = DATA_DIR / "meta"
for d in (TICK_DIR, LIST_DIR, META_DIR):
    d.mkdir(parents=True, exist_ok=True)

RATE_PER_SEC = float(os.getenv("RATE_PER_SEC", 3.5))
MAX_TICK_PAGES = int(os.getenv("MAX_TICK_PAGES", 400))

SESSION_OPEN = "090000"
SESSION_CLOSE = "153000"
BASE_TIC_SCOPE = 30
TICK_MULS = [1, 2, 4, 8, 12, 16, 24]
