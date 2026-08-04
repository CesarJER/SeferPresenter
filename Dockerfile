FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_SEFER_LIVE_AUDIO_BUILD=false
ARG VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=false
ARG VITE_AUTODUCK_ROLES=control,audience
ARG VITE_ORGANIZATION_NAME=
ARG VITE_ORGANIZATION_LEGAL_ID=
ARG VITE_ORGANIZATION_EMAIL=
ARG VITE_ORGANIZATION_WEBSITE=
ARG VITE_PRIVACY_POLICY_PATH=/legal/privacy.md
ARG VITE_PRIVACY_SUMMARY_PATH=/legal/privacy-summary.md
ARG VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS=24
ENV VITE_SEFER_LIVE_AUDIO_BUILD=$VITE_SEFER_LIVE_AUDIO_BUILD \
    VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT=$VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT \
    VITE_AUTODUCK_ROLES=$VITE_AUTODUCK_ROLES \
    VITE_ORGANIZATION_NAME=$VITE_ORGANIZATION_NAME \
    VITE_ORGANIZATION_LEGAL_ID=$VITE_ORGANIZATION_LEGAL_ID \
    VITE_ORGANIZATION_EMAIL=$VITE_ORGANIZATION_EMAIL \
    VITE_ORGANIZATION_WEBSITE=$VITE_ORGANIZATION_WEBSITE \
    VITE_PRIVACY_POLICY_PATH=$VITE_PRIVACY_POLICY_PATH \
    VITE_PRIVACY_SUMMARY_PATH=$VITE_PRIVACY_SUMMARY_PATH \
    VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS=$VITE_SEFER_AUDIENCE_STORAGE_TTL_HOURS

# Build from an explicit allowlist. User data, local env files, legacy assets,
# tests, and agent metadata must never enter the builder context or cache.
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js ./
COPY index.html presenter.html audience.html control.html audio-editor.html catalog.html ./
COPY src ./src
COPY server ./server
COPY public ./public
RUN npx tsc -b && npx vite build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS production

WORKDIR /app

# Ensure we're running as a restricted user for security
RUN chown -R node:node /app

USER node

# Copy only the necessary files for production
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
# Install only production dependencies
RUN npm ci --omit=dev

# Copy build output, server, and public skeleton
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/public ./public

# Empty placeholder files for config mounts
# This prevents Docker from creating directories if the files are missing
RUN touch /app/presentations.json && \
    touch /app/audio_sync.json

EXPOSE 8787

CMD ["npm", "run", "start:local"]
