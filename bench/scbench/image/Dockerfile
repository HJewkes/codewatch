# Arm A1 agent image: SCBench's native claude_code image plus codewatch and its pinned tools.
# Build with build.sh, which also runs the audit smoke test and records the digest.
ARG BASE_IMAGE=slop-code:claude_code-2.0.51-python3.12
FROM ${BASE_IMAGE}

ARG CODEWATCH_VERSION=0.7.0
ARG PYRIGHT_VERSION=1.1.414
ARG JSCPD_VERSION=5.4.1

USER root
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

RUN node --version | grep -q '^v22\.'

COPY requirements.txt /opt/codewatch-a1/requirements.txt
RUN uv venv --no-cache --python 3.12 /opt/codewatch-a1/py \
    && uv pip install --no-cache --python /opt/codewatch-a1/py/bin/python -r /opt/codewatch-a1/requirements.txt

RUN npm install --prefix /opt/codewatch-a1/node --cache /opt/codewatch-a1/npm-cache --no-fund --no-audit \
        "@codewatch/cli@${CODEWATCH_VERSION}" "pyright@${PYRIGHT_VERSION}" "jscpd@${JSCPD_VERSION}" \
    && rm -rf /opt/codewatch-a1/npm-cache

# Only the tool entry points go in bin/, so the tools venv's python never shadows the workspace's.
RUN mkdir -p /opt/codewatch-a1/bin \
    && for tool in ruff vulture pydoclint lint-imports coverage pytest; do \
        ln -s "/opt/codewatch-a1/py/bin/${tool}" "/opt/codewatch-a1/bin/${tool}"; \
    done \
    && for tool in pyright jscpd; do \
        ln -s "/opt/codewatch-a1/node/node_modules/.bin/${tool}" "/opt/codewatch-a1/bin/${tool}"; \
    done

# The synthesis stage (bench/scbench/synthesis), passed by build.sh as a named build context.
COPY --from=synthesis . /opt/codewatch-a1/synthesis

# The spec-aware commit review (bench/scbench/review); it imports synthesis's model call.
COPY --from=review . /opt/codewatch-a1/review

# The PR-flow stages (bench/scbench/prflow): repo-init, pr-open and commit-ratchet.
COPY --from=prflow . /opt/codewatch-a1/prflow

# Tier T test-shape checks, run by path: python3 /opt/codewatch-a1/tiert <root>.
COPY --from=tiert . /opt/codewatch-a1/tiert

COPY codewatch-wrapper.sh /usr/local/bin/codewatch
RUN chmod 755 /usr/local/bin/codewatch \
    && chmod -R a+rX /opt/codewatch-a1 \
    && codewatch --version | grep -qx "${CODEWATCH_VERSION}"

COPY assert-clean.sh /opt/codewatch-a1/assert-clean.sh
RUN bash /opt/codewatch-a1/assert-clean.sh && rm /opt/codewatch-a1/assert-clean.sh

LABEL io.codewatch.scbench.arm="A1" \
      io.codewatch.scbench.codewatch-version="${CODEWATCH_VERSION}" \
      io.codewatch.scbench.pyright-version="${PYRIGHT_VERSION}" \
      io.codewatch.scbench.jscpd-version="${JSCPD_VERSION}"

USER agent
WORKDIR /workspace
SHELL ["/bin/bash", "-lc"]
