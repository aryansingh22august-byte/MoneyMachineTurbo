FROM python:3.11-slim

WORKDIR /app

# System deps for numpy/scikit-learn compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (cached layer)
COPY requirements.txt .
# Install torch separately from the CPU-only index to avoid pulling the ~2GB
# CUDA wheel. Anchored to the start of the line: a bare `grep -v torch` also
# dropped any comment that happened to mention torch.
RUN grep -vE '^torch' requirements.txt > req_no_torch.txt && \
    pip install --no-cache-dir -r req_no_torch.txt && \
    pip install --no-cache-dir 'torch>=2.1.0' --index-url https://download.pytorch.org/whl/cpu

# Copy ML source
COPY . .


# Start Uvicorn using Railway-assigned $PORT (falls back to 5000 locally)
CMD ["sh", "-c", "uvicorn ml_api:app --host 0.0.0.0 --port ${PORT:-5000}"]
