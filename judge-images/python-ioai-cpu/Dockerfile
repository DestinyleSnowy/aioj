FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
    accelerate==1.8.1 \
    datasets==3.6.0 \
    matplotlib==3.10.0 \
    openai==1.93.0 \
    numpy \
    pandas \
    Pillow==11.1.0 \
    scipy==1.14.1 \
    scikit-learn==1.6.1 \
    torch==2.5.1 \
    torchvision==0.20.1 \
    tqdm==4.67.1 \
    transformers==4.53.2

RUN useradd -m -u 1000 runner

USER runner
WORKDIR /workspace
