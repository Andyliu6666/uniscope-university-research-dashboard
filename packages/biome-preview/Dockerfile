FROM rust:1.100.0-bookworm@sha256:75d26c23c24cc6ea1cdabf0714a6bff8fd7bf3248716043fd7ae86dac7f41b94 AS build
ARG REVISION=100d4d7fa9f95f701c47e6734b00553e4de0b9c6
ARG RUST_NIGHTLY=nightly-2026-11-28
RUN rustup toolchain install "${RUST_NIGHTLY}" --profile minimal
ENV RUSTUP_TOOLCHAIN=${RUST_NIGHTLY} CARGO_BUILD_JOBS=3 \
    CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=32 CARGO_PROFILE_RELEASE_OPT_LEVEL=1
WORKDIR /src
ADD --checksum=sha256:4c97c8f9d03f778617495afbbdc322a486474066895547a917234118eba057bc https://codeload.github.com/biomejs/biome/tar.gz/${REVISION} /tmp/biome.tar.gz
RUN tar xzf /tmp/biome.tar.gz --strip-components=1 \
 && BIOME_VERSION=2.6.9-preview.100d4d7fa cargo build --release --locked -p biome_cli \
 && strip target/release/biome

FROM debian:testing-slim@sha256:501494a9e260de3e9e8989acab51064bbf4235f10cca22957df12d89f3023e12
COPY --from=build /src/target/release/biome /usr/local/bin/biome
ENTRYPOINT ["biome"]
