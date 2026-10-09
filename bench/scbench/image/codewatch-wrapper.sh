#!/bin/sh
# The pinned tools go on PATH for codewatch only, so the solve session sees the same PATH as arm A1a.
PATH="/opt/codewatch-a1/bin:$PATH"
export PATH
exec /opt/codewatch-a1/node/node_modules/.bin/codewatch "$@"
