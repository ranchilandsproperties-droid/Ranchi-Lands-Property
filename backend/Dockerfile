# Render's plain Node runtime doesn't ship ffmpeg or the Cairo/Pango libs that
# node-canvas needs, so we deploy the backend as a Docker web service instead
# (Render's free tier supports Docker-based Web Services).
FROM node:18-bullseye-slim

# ffmpeg for rendering, plus the native libs node-canvas compiles against
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Free-tier disk is ephemeral (cleared on redeploy/restart) — fine here since
# finalize() already deletes raw uploads once the export is done; just know
# preview/output files won't survive a redeploy.
RUN mkdir -p uploads outputs temp

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
