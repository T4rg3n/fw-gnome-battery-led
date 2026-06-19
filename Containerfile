FROM node:lts-alpine

# glib provides glib-compile-schemas needed by the build.
# Using npm (not pnpm) avoids interactive build-script approval prompts in CI.
RUN apk add --no-cache glib

WORKDIR /workspace
