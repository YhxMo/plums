"""Run only on an explicitly selected isolated emulator; reset this probe app."""
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

root = Path(os.environ.get('PLUMS_TLS_PROBE_ROOT', '.cache/m2-3-1')).resolve()
serial = os.environ['ANDROID_SERIAL']
assert serial.startswith('emulator-'), 'Use a dedicated emulator'
adb = ['adb', '-P', os.environ['ANDROID_ADB_SERVER_PORT'], '-s', serial]
port = json.loads((root / 'fixtures/server.json').read_text())['port']
source = root / 'android-project/app/build/outputs/apk/debug/app-debug.apk'
candidate = root / 'android-test-companion.apk'
shutil.copyfile(source, candidate)
before = json.loads((root / 'fixtures/server-counts.json').read_text())
(root / 'android-before-server-counts.json').write_text(json.dumps(before, indent=2) + '\n')


def run(*args):
    return subprocess.check_output(adb + list(args))


run('install', '-r', str(candidate))
run('shell', 'am', 'force-stop', 'dev.plums.tlsprobe')
assert run('shell', 'pm', 'clear', 'dev.plums.tlsprobe').strip() == b'Success'
run('reverse', f'tcp:{port}', f'tcp:{port}')
run('shell', 'am', 'start', '-W', '-n', 'dev.plums.tlsprobe/.ProbeActivity', '--ei', 'port', str(port))
for _ in range(60):
    result = subprocess.run(adb + ['exec-out', 'run-as', 'dev.plums.tlsprobe', 'cat', 'files/result.json'], capture_output=True)
    if result.returncode == 0:
        try:
            report = json.loads(result.stdout)
            break
        except ValueError:
            pass
    time.sleep(1)
else:
    raise SystemExit('Probe did not complete within 60 seconds')
(root / 'android-result.json').write_text(json.dumps(report, indent=2) + '\n')
run('shell', 'uiautomator', 'dump', '/data/local/tmp/tls-probe.xml')
view = run('exec-out', 'cat', '/data/local/tmp/tls-probe.xml')
(root / 'android-view.xml').write_bytes(view)
assert b'root_reset_rejected' in view
(root / 'android-screen.png').write_bytes(run('exec-out', 'screencap', '-p'))
info = {name: run('shell', 'getprop', name).decode().strip()
        for name in ['ro.build.version.sdk', 'ro.product.cpu.abi', 'ro.build.fingerprint']}
(root / 'android-device.json').write_text(json.dumps(info, indent=2) + '\n')
after = json.loads((root / 'fixtures/server-counts.json').read_text())
(root / 'android-after-server-counts.json').write_text(json.dumps(after, indent=2) + '\n')
assert not after['forbidden']
for name, value in after['requests'].items():
    assert value - before['requests'][name] == (1 if name == 'trusted.probe.invalid' else 0)
print(json.dumps(report, indent=2))
subprocess.run(['python3', str(Path(__file__).with_name('assert-result.py')), str(root / 'android-result.json')], check=True)
