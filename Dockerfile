FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npx tsc -b && npx vite build

FROM node:20-alpine AS production

WORKDIR /app

# Ensure we're running as a restricted user for security
RUN chown -R node:node /app

USER node

# Copy only the necessary files for production
COPY --from=builder --chown=node:node /app/package*.json ./
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
