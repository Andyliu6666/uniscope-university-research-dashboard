FROM postgres:19-alpine3.24@sha256:cac45fb483caee3668946088a1c0532db89d5285c28dbfeac889b4068296e06f AS base
FROM base AS build
ARG REVISION=cf9d92d1f7550063aefbb219e1160e58ddb760ac
ADD --checksum=sha256:52ffa684828e3057e76b980fe33eb3c105f530ad034501cc02ecc69b0b560057 https://codeload.github.com/postgres/postgres/tar.gz/${REVISION} /tmp/postgres.tar.gz
RUN apk add --no-cache build-base linux-headers bison flex perl icu-dev openssl-dev zlib-dev lz4-dev zstd-dev readline-dev
WORKDIR /src
RUN tar -xzf /tmp/postgres.tar.gz --strip-components=1 \
 && ./configure --prefix=/opt/pg20 --with-ssl=openssl --with-icu --with-lz4 --with-zstd \
 && make -j"$(nproc)" world-bin \
 && make install-world-bin

FROM base
COPY --from=build /opt/pg20 /opt/pg20
ENV PG_MAJOR=20 PG_VERSION=20devel PGDATA=/var/lib/postgresql/20/docker
ENV PATH="/opt/pg20/bin:${PATH}" LD_LIBRARY_PATH=/opt/pg20/lib
RUN apk add --no-cache readline && postgres --version && pg_restore --version
CMD ["postgres", "-c", "listen_addresses=*"]
