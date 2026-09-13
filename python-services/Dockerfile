FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin libgdal-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt 2>/dev/null || echo "fastapi uvicorn numpy pillow rasterio" > /tmp/req.txt
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || pip install --no-cache-dir fastapi uvicorn numpy pillow rasterio
COPY . .
EXPOSE 8100
CMD ["uvicorn", "env_data.api:app", "--host", "0.0.0.0", "--port", "8100"]
