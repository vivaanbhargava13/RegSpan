#!/bin/sh
set -eu

node /app/scripts/runtimePreflight.mjs
exec node /app/server.js
