# Build context MUST be the REPOSITORY ROOT, not tools/db-migrator/:
#   docker build -f tools/db-migrator/Dockerfile -t <tag> .
#
# schema-audit needs every service's prisma/migrations directory (the repo's
# source of truth for expected schema), which lives outside tools/db-migrator/.
FROM postgres:16-bookworm

# Base image is the SAME major version as the Aurora PostgreSQL target, so
# psql/pg_dump/pg_restore always match the server's catalog version (a prior
# mismatch here caused "column d.daticulocale does not exist").
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       awscli \
       ca-certificates \
       curl \
       gnupg \
       gawk \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g prisma@5.22.0 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Only the Prisma migration folders are needed to compute expected schema —
# no app source, no node_modules, no secrets.
COPY backend/services/auth-service/prisma/migrations     /work/migrations/auth-service/migrations
COPY backend/services/user-service/prisma/migrations     /work/migrations/user-service/migrations
COPY backend/services/fitness-service/prisma/migrations  /work/migrations/fitness-service/migrations
COPY backend/services/gym-service/prisma/migrations      /work/migrations/gym-service/migrations
COPY backend/services/payment-service/prisma/migrations  /work/migrations/payment-service/migrations
COPY backend/services/chat-service/prisma/migrations     /work/migrations/chat-service/migrations
COPY backend/services/ai-service/prisma/migrations       /work/migrations/ai-service/migrations

COPY tools/db-migrator/entrypoint.sh /work/entrypoint.sh
COPY tools/db-migrator/scripts/      /work/scripts/

RUN sed -i 's/\r$//' /work/entrypoint.sh /work/scripts/*.sh \
    && chmod +x /work/entrypoint.sh /work/scripts/*.sh \
    && bash -n /work/entrypoint.sh \
    && for f in /work/scripts/*.sh; do bash -n "$f"; done \
    && mkdir -p /work/shadow-data /work/shadow-run /work/dumps /work/lists /work/generated /work/reports \
    && chown -R postgres:postgres /work/shadow-data /work/shadow-run

ENTRYPOINT ["/bin/bash", "/work/entrypoint.sh"]
