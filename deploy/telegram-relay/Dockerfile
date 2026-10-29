ARG PYTHON_BASE_IMAGE=python:3.12-alpine
FROM ${PYTHON_BASE_IMAGE}
LABEL com.sidzen.component="telegram-relay"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /relay
COPY relay.py /relay/relay.py
USER 10001:10001
CMD ["python", "/relay/relay.py"]
