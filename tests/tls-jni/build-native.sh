#!/bin/zsh
set -eu
cd "$(dirname "$0")/../.."
: "${PLUMS_ANDROID_TOOLS_ROOT:?Set the existing Android toolchain directory}"
source "$PLUMS_ANDROID_TOOLS_ROOT/env.sh"
export CARGO_HOME="$PWD/.cache/cargo"
export PLUMS_TLS_PROBE_ROOT="${PLUMS_TLS_PROBE_ROOT:-$PWD/.cache/m2-3-1}"
export CARGO_TARGET_DIR="$PLUMS_TLS_PROBE_ROOT/target"
export CARGO_BUILD_JOBS=4
export TMPDIR="$PLUMS_TLS_PROBE_ROOT/tmp"
mkdir -p "$TMPDIR"
ndkbin="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export CC_aarch64_linux_android="$ndkbin/aarch64-linux-android26-clang"
export CXX_aarch64_linux_android="$ndkbin/aarch64-linux-android26-clang++"
export AR_aarch64_linux_android="$ndkbin/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC_aarch64_linux_android"
cargo build --offline --locked --manifest-path tests/tls-jni/Cargo.toml --lib --target aarch64-linux-android
