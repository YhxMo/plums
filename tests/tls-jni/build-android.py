"""Assemble the isolated Gradle input; no changes to Tauri's generated project."""
import os
import shutil
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
source = repo / 'tests/tls-jni'
run = Path(os.environ.get('PLUMS_TLS_PROBE_ROOT', repo / '.cache/m2-3-1')).resolve()
output = run / 'android-project'
lock = (source / 'Cargo.lock').read_text()
assert 'name = "rustls-platform-verifier"\nversion = "0.7.1"' in lock
assert 'name = "rustls-platform-verifier-android"\nversion = "0.2.0"' in lock
app = output / 'app'
main = app / 'src/main'
for path in ['java/dev/plums/tlsprobe', 'res/xml', 'res/raw', 'jniLibs/arm64-v8a']:
    (main / path).mkdir(parents=True, exist_ok=True)
for filename in ['settings.gradle.kts', 'build.gradle.kts']:
    shutil.copyfile(source / 'android' / filename, output / filename)
shutil.copyfile(source / 'Cargo.lock', output / 'Cargo.lock')
for src, dest in {
    'app.gradle.kts': app / 'build.gradle.kts',
    'AndroidManifest.xml': main / 'AndroidManifest.xml',
    'ProbeActivity.java': main / 'java/dev/plums/tlsprobe/ProbeActivity.java',
    'network_security_config.xml': main / 'res/xml/network_security_config.xml',
}.items():
    shutil.copyfile(source / 'android' / src, dest)
shutil.copyfile(run / 'fixtures/ca.der', main / 'res/raw/probe_ca.der')
shutil.copyfile(run / 'target/aarch64-linux-android/debug/libplums_tls_jni_probe.so',
                main / 'jniLibs/arm64-v8a/libplums_tls_jni_probe.so')
support = output / 'verifier-support'
kotlin = support / 'src/main/java/org/rustls/platformverifier'
kotlin.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'android/verifier-support.gradle.kts', support / 'build.gradle.kts')
shutil.copyfile(run / 'CertificateVerifier.kt', kotlin / 'CertificateVerifier.kt')
assets = main / 'assets/third-party/rustls-platform-verifier'
assets.mkdir(parents=True, exist_ok=True)
for name in ['LICENSE-MIT', 'LICENSE-APACHE']:
    shutil.copyfile(run / name, assets / name)
(output / 'local.properties').write_text(f"sdk.dir={os.environ['ANDROID_HOME']}\n")
print('Prepared isolated Android Gradle input')
