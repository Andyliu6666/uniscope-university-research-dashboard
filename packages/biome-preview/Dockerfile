FROM rust:1.100.0-bookworm@sha256:75d26c23c24cc6ea1cdabf0714a6bff8fd7bf3248716043fd7ae86dac7f41b94 AS build
ARG REVISION=100d4d7fa9f95f701c47e6734b00553e4de0b9c6
WORKDIR /src
ADD --checksum=sha256:4c97c8f9d03f778617495afbbdc322a486474066895547a917234118eba057bc https://codeload.github.com/biomejs/biome/tar.gz/${REVISION} /tmp/biome.tar.gz
RUN tar xzf /tmp/biome.tar.gz --strip-components=1 \
 && BIOME_VERSION=2.6.9-preview.100d4d7fa cargo build --release --locked -p biome_cli \
 && strip target/release/biome

FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e
COPY --from=build /src/target/release/biome /usr/local/bin/biome
ENTRYPOINT ["biome"]
