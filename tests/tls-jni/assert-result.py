"""Fail closed on a missing probe or incomplete/false acceptance results."""
import json
import sys
from pathlib import Path

result = json.loads(Path(sys.argv[1]).read_text())
assert result['platform'] in ('macos', 'android')
assert result['tls'] == {
    'trusted': True, 'untrusted_rejected': True,
    'hostname_rejected': True, 'expired_rejected': True, 'root_reset_rejected': True,
}, result
if result['platform'] == 'android':
    assert result['jni'] == {
        'read': True, 'java_cleared': True, 'rust_cleared': True,
        'missing_rejected': True, 'exception_rejected': True, 'recovered': True,
    }, result
print('TLS/JNI acceptance passed:', result['platform'])
