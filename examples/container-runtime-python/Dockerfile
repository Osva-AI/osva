FROM python:3.12-slim

WORKDIR /app

COPY sdks/python /sdks/python
COPY examples/container-runtime-python/main.py ./main.py

RUN pip install --no-cache-dir /sdks/python

ENTRYPOINT ["python", "main.py"]
