FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=5000

# Tesseract OCR (عربي + إنجليزي) لقراءة المستندات الممسوحة
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# كل البيانات (قاعدة البيانات + المستندات + النسخ الاحتياطية) في /app/data
# اربط عليه Volume في Suga عشان البيانات متضيعش مع كل نشر
VOLUME ["/app/data"]

EXPOSE 5000

CMD ["python", "wsgi.py"]
