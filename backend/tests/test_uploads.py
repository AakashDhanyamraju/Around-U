"""Cloudinary signed uploads."""

import pytest

from app.config import settings


class TestUploadSignature:
    def test_requires_auth(self, client):
        assert client.post("/api/uploads/signature").status_code == 401

    @pytest.mark.skipif(
        not settings.cloudinary_configured, reason="Cloudinary not configured"
    )
    def test_signature_payload(self, client, registered_user):
        r = client.post("/api/uploads/signature", headers=registered_user["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["cloud_name"] == settings.cloudinary_cloud_name
        assert body["signature"]
        assert body["timestamp"] > 0
        assert body["upload_url"].endswith("/image/upload")
        assert body["folder"] == settings.cloudinary_upload_folder

    @pytest.mark.skipif(
        not settings.cloudinary_configured, reason="Cloudinary not configured"
    )
    def test_secret_is_never_returned(self, client, registered_user):
        r = client.post("/api/uploads/signature", headers=registered_user["headers"])
        assert settings.cloudinary_api_secret not in r.text

    @pytest.mark.skipif(
        not settings.cloudinary_configured, reason="Cloudinary not configured"
    )
    def test_subfolder_stays_inside_the_configured_root(self, client, registered_user):
        r = client.post(
            "/api/uploads/signature",
            headers=registered_user["headers"],
            params={"folder": "../../escaped"},
        )
        assert r.status_code == 200
        assert r.json()["folder"].startswith(settings.cloudinary_upload_folder)

    @pytest.mark.skipif(
        settings.cloudinary_configured, reason="Cloudinary is configured"
    )
    def test_unconfigured_returns_503(self, client, registered_user):
        r = client.post("/api/uploads/signature", headers=registered_user["headers"])
        assert r.status_code == 503
