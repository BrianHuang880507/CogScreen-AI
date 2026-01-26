FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md .
COPY backend backend
COPY frontend frontend
COPY static static

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
