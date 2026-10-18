# Arm A1 agent image: SCBench's native claude_code image plus codewatch and its pinned tools.
# Build with build.sh, which also runs the audit smoke test and records the digest.
ARG BASE_IMAGE=slop-code:claude_code-2.0.51-python3.12
FROM ${BASE_IMAGE}

ARG PYRIGHT_VERSION=1.1.414
ARG JSCPD_VERSION=5.4.1

USER root
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

RUN node --version | grep -q '^v22\.'

COPY requirements.txt /opt/codewatch-a1/requirements.txt
RUN uv venv --no-cache --python 3.12 /opt/codewatch-a1/py \
    && uv pip install --no-cache --python /opt/codewatch-a1/py/bin/python -r /opt/codewatch-a1/requirements.txt

RUN npm install --prefix /opt/codewatch-a1/node --cache /opt/codewatch-a1/npm-cache --no-fund --no-audit \
        "pyright@${PYRIGHT_VERSION}" "jscpd@${JSCPD_VERSION}" \
    && rm -rf /opt/codewatch-a1/npm-cache

# The CLI is the `pnpm deploy` directory build.sh stages from a clean codewatch sha, not an npm
# release, so the image can carry merged work that has no release yet. build.sh passes its
# version, source sha and artifact hash (see artifact.py); they are declared here so the tool
# layers above stay cached across shas.
ARG CODEWATCH_VERSION
ARG CODEWATCH_SOURCE_SHA
ARG CODEWATCH_ARTIFACT_SHA256
COPY codewatch /opt/codewatch-a1/node/codewatch
RUN test -n "${CODEWATCH_VERSION}" && test -n "${CODEWATCH_SOURCE_SHA}" && test -n "${CODEWATCH_ARTIFACT_SHA256}" \
    && ln -s ../../codewatch/dist/index.js /opt/codewatch-a1/node/node_modules/.bin/codewatch

# Only the tool entry points go in bin/, so the tools venv's python never shadows the workspace's.
RUN mkdir -p /opt/codewatch-a1/bin \
    && for tool in ruff vulture pydoclint lint-imports coverage pytest; do \
        ln -s "/opt/codewatch-a1/py/bin/${tool}" "/opt/codewatch-a1/bin/${tool}"; \
    done \
    && for tool in pyright jscpd; do \
        ln -s "/opt/codewatch-a1/node/node_modules/.bin/${tool}" "/opt/codewatch-a1/bin/${tool}"; \
    done

# The stage packages below are copied into the build context by build.sh (stage_context).
# The synthesis stage (bench/scbench/synthesis).
COPY synthesis /opt/codewatch-a1/synthesis

# The spec-aware commit review (bench/scbench/review); it imports synthesis's model call.
COPY review /opt/codewatch-a1/review

# The PR-flow stages (bench/scbench/prflow): repo-init, pr-open and commit-ratchet.
COPY prflow /opt/codewatch-a1/prflow

# Tier T test-shape checks, run by path: python3 /opt/codewatch-a1/tiert <root>.
COPY tiert /opt/codewatch-a1/tiert

# The remediation stage (bench/scbench/remediation), run as
# PYTHONPATH=/opt/codewatch-a1 python -P -m remediation.
COPY remediation /opt/codewatch-a1/remediation

COPY codewatch-wrapper.sh /usr/local/bin/codewatch
RUN chmod 755 /usr/local/bin/codewatch \
    && chmod -R a+rX /opt/codewatch-a1 \
    && codewatch --version | grep -qx "${CODEWATCH_VERSION}"

COPY assert-clean.sh /opt/codewatch-a1/assert-clean.sh
RUN bash /opt/codewatch-a1/assert-clean.sh && rm /opt/codewatch-a1/assert-clean.sh

LABEL io.codewatch.scbench.arm="A1" \
      io.codewatch.scbench.codewatch-version="${CODEWATCH_VERSION}" \
      io.codewatch.scbench.codewatch-source-sha="${CODEWATCH_SOURCE_SHA}" \
      io.codewatch.scbench.codewatch-artifact-sha256="${CODEWATCH_ARTIFACT_SHA256}" \
      io.codewatch.scbench.pyright-version="${PYRIGHT_VERSION}" \
      io.codewatch.scbench.jscpd-version="${JSCPD_VERSION}"

USER agent
WORKDIR /workspace
SHELL ["/bin/bash", "-lc"]
