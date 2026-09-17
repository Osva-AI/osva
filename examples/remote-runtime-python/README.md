# Python remote runtime example

Requires Python >=3.11, the local `osva-sdk` package, and `uvicorn` to serve the ASGI app.

```bash
cd sdks/python
pip install -e ".[dev]"
pip install uvicorn
PYTHONPATH=src python ../examples/remote-runtime-python/main.py
```
