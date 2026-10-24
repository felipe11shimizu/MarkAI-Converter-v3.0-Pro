import socket

import pytest
from fastapi import HTTPException

from backend import app as backend_app


def _addrinfo(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0))]


def test_url_rejects_non_http_scheme():
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_url("file:///etc/passwd")
    assert exc.value.status_code == 400


def test_url_rejects_embedded_credentials():
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_url("https://user:password@example.com/file.pdf")
    assert exc.value.status_code == 400


@pytest.mark.parametrize("address", [
    "127.0.0.1",
    "10.0.0.5",
    "169.254.169.254",
    "::1",
    "fc00::1",
])
def test_public_host_validation_rejects_private_or_reserved_ips(monkeypatch, address):
    monkeypatch.setattr(backend_app.socket, "getaddrinfo", lambda *args, **kwargs: _addrinfo(address))
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_public_host("example.test")
    assert exc.value.status_code == 403


def test_public_host_validation_rejects_if_any_resolved_ip_is_private(monkeypatch):
    def mixed_resolution(*args, **kwargs):
        return _addrinfo("93.184.216.34") + _addrinfo("127.0.0.1")

    monkeypatch.setattr(backend_app.socket, "getaddrinfo", mixed_resolution)
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_public_host("mixed.example")
    assert exc.value.status_code == 403


def test_public_host_validation_rejects_unresolvable_domain(monkeypatch):
    def fail_resolution(*args, **kwargs):
        raise socket.gaierror("not found")

    monkeypatch.setattr(backend_app.socket, "getaddrinfo", fail_resolution)
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_public_host("missing.example")
    assert exc.value.status_code == 422

def test_redirect_destination_is_revalidated_before_request(monkeypatch):
    validated = []
    requests = []

    def validate_public_host(hostname):
        validated.append(hostname)
        if hostname == "private.test":
            raise HTTPException(status_code=403, detail="blocked")
    
    monkeypatch.setattr(backend_app, "_validate_public_host", validate_public_host)

    class RedirectResponse:
        status_code = 302
        headers = {"location": "http://private.test/admin"}

    class StreamContext:
        def __enter__(self):
            return RedirectResponse()

        def __exit__(self, *args):
            return False

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, method, url):
            requests.append(url)
            return StreamContext()

    monkeypatch.setattr(backend_app.httpx, "Client", FakeClient)
    with pytest.raises(HTTPException) as exc:
        backend_app._fetch_remote_url("https://public.test/start")
    assert exc.value.status_code == 403
    assert validated == ["public.test", "private.test"]
    assert requests == ["https://public.test/start"]
