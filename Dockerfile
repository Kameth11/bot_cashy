# Imagen única: bot + API + dashboard (Express sirve dashboard/dist).
# Permite correr en cualquier plataforma que acepte contenedores (Railway, Render,
# Fly.io, un VPS). Es UN solo proceso con estado en memoria: no escalar a más de
# una instancia ni usar plataformas que se duermen (ver PLAN_BASE_DE_DATOS.md §7).

# ── Etapa 1: build del dashboard ──
FROM node:20-slim AS dashboard
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ── Etapa 2: backend de producción ──
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
# clientes.json se crea en runtime junto a src/: el usuario node necesita escribir acá
RUN chown node:node /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=dashboard /dashboard/dist ./dashboard/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
