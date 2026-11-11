FROM node:20-alpine

WORKDIR /app

# Install ca-certificates and cloudflared for optional tunneling
RUN apk add --no-cache curl ca-certificates bash \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64) CF_ARCH="amd64" ;; \
        aarch64) CF_ARCH="arm64" ;; \
        *) CF_ARCH="amd64" ;; \
    esac \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=7001
ENV DATA_DIR=/data

EXPOSE 7001

VOLUME ["/data"]

CMD ["node", "index.js"]

