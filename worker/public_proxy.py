"""Loopback-only HTTPS CONNECT gateway: resolve, reject non-public IPs, pin TCP.

TLS stays end-to-end in the caller; no certificate interception or insecure mode.
Every yt-dlp/urllib request, including redirects and CDN URLs, uses this gateway.
Do not run this direct-egress gateway inside a proxy-restricted managed executor.
"""
import ipaddress
import select
import socket
import socketserver
import threading
import time
from urllib.parse import urlsplit


def public_addresses(host, resolver=socket.getaddrinfo):
    if not isinstance(host, str) or len(host) > 253 or any(c in host for c in '/\\@\r\n\x00'):
        raise ValueError('Invalid public hostname')
    if '.' not in host or host.lower().rstrip('.').endswith(('.local', '.internal', '.localhost', '.test', '.invalid', '.onion')):
        raise ValueError('Private hostname is not allowed')
    try:
        ipaddress.ip_address(host.strip('[]'))
    except ValueError:
        pass
    else:
        raise ValueError('Literal IP destinations are not allowed')
    addresses = list(dict.fromkeys(row[4][0] for row in resolver(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(address).is_global or ipaddress.ip_address(address).is_multicast for address in addresses):
        raise ValueError('Destination resolves to a non-public address')
    return addresses


def validate_url(value, max_length=1000):
    if not isinstance(value, str) or len(value) > max_length or any(c in value for c in '\r\n\x00'):
        raise ValueError('Invalid URL')
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Only public HTTPS URLs without credentials are supported')
    # Network validation is repeated by CONNECT immediately before each socket.
    public_addresses(parsed.hostname)
    return value


class _Handler(socketserver.BaseRequestHandler):
    def handle(self):
        remote = None
        try:
            self.request.settimeout(10)
            headers = bytearray()
            while b'\r\n\r\n' not in headers:
                chunk = self.request.recv(1024)
                if not chunk or len(headers) + len(chunk) > 8192:
                    raise ValueError('Invalid CONNECT headers')
                headers.extend(chunk)
            header, remainder = bytes(headers).split(b'\r\n\r\n', 1)
            method, authority, version = header.split(b'\r\n', 1)[0].decode('ascii').split(' ')
            if method != 'CONNECT' or version not in ('HTTP/1.0', 'HTTP/1.1') or remainder:
                raise ValueError('Only HTTPS CONNECT is supported')
            host, port = authority.rsplit(':', 1)
            if port != '443':
                raise ValueError('Only HTTPS port 443 is supported')
            addresses = public_addresses(host)
            remote = socket.create_connection((addresses[0], 443), timeout=12)
            self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            self.request.setblocking(False)
            remote.setblocking(False)
            transferred = 0
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                readable, _, _ = select.select([self.request, remote], [], [], 1)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    transferred += len(data)
                    if transferred > 55 * 1024 * 1024:
                        return
                    destination = remote if source is self.request else self.request
                    destination.setblocking(True)
                    destination.settimeout(12)
                    destination.sendall(data)
                    destination.setblocking(False)
        except (OSError, ValueError, UnicodeError):
            try:
                self.request.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
        finally:
            if remote:
                remote.close()


class _Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = False


class PublicProxy:
    def __enter__(self):
        self.server = _Server(('127.0.0.1', 0), _Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
