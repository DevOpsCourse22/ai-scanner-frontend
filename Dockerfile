# frontend-react — the user-facing UI, built once and served as static files.
#
# Build context is THIS folder:
#
#     docker build -t review-frontend ./frontend-react
#     docker run --rm -p 127.0.0.1:8081:8080 review-frontend
#
# VITE_GATEWAY_URL is baked into the JavaScript at BUILD time (Vite replaces
# import.meta.env.VITE_GATEWAY_URL with the literal value). The default, an
# empty string, makes every call same-origin (fetch("/auth/me")), which is
# what the Kubernetes Ingress serves: the UI and the gateway behind one
# address. For a gateway on another address, build with
#     --build-arg VITE_GATEWAY_URL=http://localhost:8080

# ---- build: node only exists in this stage, not in the final image --------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so editing source does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG VITE_GATEWAY_URL=""
ENV VITE_GATEWAY_URL=${VITE_GATEWAY_URL}
RUN npm run build

# ---- runtime: nginx as a non-root user (uid 101), listening on 8080 --------
# nginx 1.30 is the current stable branch (even minor versions are stable,
# odd ones mainline). 1.28 stopped getting updates: the CI scan found
# CRITICAL fixes missing in its last image (nginx CVE-2026-42945, OpenSSL
# CVE-2026-31789).
FROM nginxinc/nginx-unprivileged:1.30-alpine

# Two steps that need root (the base image already switched to uid 101):
# - apk upgrade: install the Alpine security fixes released since the base
#   image was built, so a fix does not wait for the next nginx image;
# - only our site is served: drop the packaged default site and pages.
USER root
RUN apk upgrade --no-cache     && rm -f /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*

COPY --chown=101:101 nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
