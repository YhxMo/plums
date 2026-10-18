"""Local-only TLS fixtures. Private test keys and raw output stay under .cache."""
import argparse
import json
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOSTS = ('trusted.probe.invalid', 'untrusted.probe.invalid',
         'mismatch.probe.invalid', 'expired.probe.invalid')


def prepare(root):
    root.mkdir(parents=True, exist_ok=False)
    (root / 'index').touch()
    (root / 'serial').write_text('1000\n')
    (root / 'ca.cnf').write_text('''[ca]
default_ca=local
[local]
database=index
serial=serial
new_certs_dir=.
certificate=ca.pem
private_key=ca.key
default_md=sha256
default_days=2
policy=names
unique_subject=no
[names]
commonName=supplied
[req]
distinguished_name=dn
x509_extensions=root
prompt=no
[dn]
CN=Plums disposable TLS probe CA
[root]
basicConstraints=critical,CA:true
keyUsage=critical,keyCertSign,cRLSign
''')

    def openssl(*args):
        subprocess.run(['openssl', *args], cwd=root, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    openssl('req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-config', 'ca.cnf', '-days', '2', '-keyout', 'ca.key', '-out', 'ca.pem')
    openssl('x509', '-in', 'ca.pem', '-outform', 'DER', '-out', 'ca.der')
    for i, host in enumerate(HOSTS):
        name = f'leaf{i}'
        # The mismatch leaf deliberately has the valid host's identity.
        san = HOSTS[0] if i == 2 else host
        (root / f'{name}.ext').write_text(
            'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\n'
            f'extendedKeyUsage=serverAuth\nsubjectAltName=DNS:{san}\n')
        openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', f'/CN={san}',
                '-keyout', f'{name}.key', '-out', f'{name}.csr')
        dates = ['-startdate', '20200101000000Z', '-enddate', '20210101000000Z'] if i == 3 else []
        openssl('ca', '-batch', '-config', 'ca.cnf', '-in', f'{name}.csr',
                '-out', f'{name}.pem', '-extfile', f'{name}.ext', *dates)


def serve(root):
    counts = {host: 0 for host in HOSTS}
    forbidden = []
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            with lock:
                host = self.headers.get('Host', '').split(':')[0]
                counts[host] = counts.get(host, 0) + 1
                if self.path != '/probe' or self.headers.get('Authorization'):
                    forbidden.append('unexpected request shape')
                (root / 'server-counts.json').write_text(json.dumps(
                    {'requests': counts, 'forbidden': forbidden}, indent=2) + '\n')
            self.send_response(200)
            self.send_header('Content-Length', '8')
            self.end_headers()
            self.wfile.write(b'probe-ok')

        def log_message(self, *_args):
            pass

    contexts = []
    for i in range(len(HOSTS)):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(root / f'leaf{i}.pem', root / f'leaf{i}.key')
        contexts.append(context)

    def sni(sock, name, _context):
        if name not in HOSTS:
            raise ssl.SSLError('unexpected probe SNI')
        sock.context = contexts[HOSTS.index(name)]

    contexts[0].set_servername_callback(sni)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.socket = contexts[0].wrap_socket(server.socket, server_side=True)
    (root / 'server.json').write_text(json.dumps({'port': server.server_port}) + '\n')
    print(f'Local TLS fixture ready on port {server.server_port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'serve'])
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    (prepare if args.action == 'prepare' else serve)(args.root.resolve())
