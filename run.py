import uvicorn
from src import config

if __name__ == "__main__":
    print(f"[multiTick] {'모의' if config.MOCK else '실전'} · {config.HOST} · http://127.0.0.1:{config.PORT}")
    uvicorn.run("src.api.app:app", host="127.0.0.1", port=config.PORT, reload=True)
