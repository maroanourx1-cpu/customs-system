FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "app.py"]
