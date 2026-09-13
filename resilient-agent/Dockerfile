FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY tools/ tools/

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R 10001:10001 /app

USER 10001

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.agent:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
