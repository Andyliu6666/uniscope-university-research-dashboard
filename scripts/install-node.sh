#!/bin/sh
# Install this project's verified binaries into a private prefix.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
prefix=${1:-"$root/.tools/node"}
case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "Use macOS, Linux or WSL." >&2; exit 1 ;;
esac
case $(uname -m) in
  arm64|aarch64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Unsupported CPU architecture." >&2; exit 1 ;;
esac
platform="$os-$arch"
archive=$(awk -v suffix="-$platform.tar.gz" 'index($2,suffix) { print $2 }' "$root/scripts/node-SHA256.txt")
test -n "$archive" || { echo "No verified Node build for $platform." >&2; exit 1; }
version=${archive%-$platform.tar.gz}
version=${version#node-}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fetch() {
  curl --fail --location --retry 4 --retry-all-errors --connect-timeout 15 --max-time 240 "$1" -o "$tmp/download"
}
export PATH="$prefix/bin:$PATH"
if [ ! -x "$prefix/bin/node" ] || [ "$("$prefix/bin/node" --version)" != "$version" ]; then
  fetch "https://nodejs.org/download/nightly/$version/$archive"
  expected=$(awk -v name="$archive" '$2==name {print $1}' "$root/scripts/node-SHA256.txt")
  (cd "$tmp" && if command -v sha256sum >/dev/null; then echo "$expected  download" | sha256sum -c -; else echo "$expected  download" | shasum -a 256 -c -; fi)
  mkdir -p "$prefix"
  tar -xzf "$tmp/download" -C "$prefix" --strip-components=1
fi

registry_archive() {
  url="https://registry.npmjs.org/$1"
  expected=$(awk -v u="$url" '$2==u {print $1}' "$root/scripts/npm-SHA512.txt")
  test -n "$expected" || { echo "Missing registry checksum for $url." >&2; exit 1; }
  fetch "$url"
  node -e 'const f=require("node:fs"),h=require("node:crypto").createHash("sha512"); h.update(f.readFileSync(process.argv[1])); if(h.digest("hex")!==process.argv[2]) process.exit(1)' "$tmp/download" "$expected"
}
npm_version=$(node -p 'require(process.argv[1]).engines.npm' "$root/package.json")
pnpm_version=$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$root/package.json")
if [ "$(npm --version)" != "$npm_version" ]; then
  registry_archive "npm/-/npm-$npm_version.tgz"
  mv "$tmp/download" "$tmp/npm.tgz"
  npm install --offline --global --prefix "$prefix" --ignore-scripts --no-audit --no-fund "$tmp/npm.tgz"
fi
if [ ! -x "$prefix/bin/pnpm" ] || [ "$(cd / && "$prefix/bin/pnpm" --version)" != "$pnpm_version" ]; then
  registry_archive "@pnpm/exe.$platform/-/exe.$platform-$pnpm_version.tgz"
  tar -xzf "$tmp/download" -C "$tmp" package/pnpm
  install -m 755 "$tmp/package/pnpm" "$prefix/bin/pnpm.new"
  mv -f "$prefix/bin/pnpm.new" "$prefix/bin/pnpm"
fi
