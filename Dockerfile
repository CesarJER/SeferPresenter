FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_SEFER_LIVE_AUDIO_BUILD=false
ARG VITE_SEFER_VOICE_SCRIPTURE_BUILD=false
ARG VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=false
ARG VITE_AUTODUCK_ROLES=control,audience
ARG VITE_ORGANIZATION_NAME=
ARG VITE_ORGANIZATION_LEGAL_ID=
ARG VITE_ORGANIZATION_EMAIL=
ARG VITE_ORGANIZATION_WEBSITE=
ARG VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS=24
ARG VITE_SEFER_PUBLICABLE_PERMISSION=RECORDING
ARG VITE_SEFER_PUBLICABLE_DEFAULT=off
ENV VITE_SEFER_LIVE_AUDIO_BUILD=$VITE_SEFER_LIVE_AUDIO_BUILD \
    VITE_SEFER_VOICE_SCRIPTURE_BUILD=$VITE_SEFER_VOICE_SCRIPTURE_BUILD \
    VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=$VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT \
    VITE_AUTODUCK_ROLES=$VITE_AUTODUCK_ROLES \
    VITE_ORGANIZATION_NAME=$VITE_ORGANIZATION_NAME \
    VITE_ORGANIZATION_LEGAL_ID=$VITE_ORGANIZATION_LEGAL_ID \
    VITE_ORGANIZATION_EMAIL=$VITE_ORGANIZATION_EMAIL \
    VITE_ORGANIZATION_WEBSITE=$VITE_ORGANIZATION_WEBSITE \
    VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS=$VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS \
    VITE_SEFER_PUBLICABLE_PERMISSION=$VITE_SEFER_PUBLICABLE_PERMISSION \
    VITE_SEFER_PUBLICABLE_DEFAULT=$VITE_SEFER_PUBLICABLE_DEFAULT

# Build from an explicit allowlist. User data, local env files, legacy assets,
# tests, and agent metadata must never enter the builder context or cache.
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js ./
COPY index.html presenter.html audience.html control.html audio-editor.html catalog.html ./
COPY src ./src
COPY server ./server
COPY static ./static
COPY examples ./examples
RUN npx tsc -b && npx vite build

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS production

WORKDIR /app

# Ensure we're running as a restricted user for security
RUN chown -R node:node /app

USER node

# Copy only the necessary files for production
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
# Install only production dependencies
RUN npm ci --omit=dev

# Copy build output, server, and neutral product assets
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/examples ./examples
COPY --from=builder --chown=node:node /app/src/assets/branding ./src/assets/branding

RUN mkdir -p /app/data

ENV SEFER_DATA_DIR=/app/data

EXPOSE 8787

CMD ["npm", "run", "start:local"]
