"""Run the ClaimGuard FastAPI application with Uvicorn."""
import argparse
from pathlib import Path

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parent
    import sys

    sys.path.insert(0, str(source_root))
    from api_app.main import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
