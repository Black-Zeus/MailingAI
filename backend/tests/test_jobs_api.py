import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_create_and_get_job(client: TestClient):
    create_response = client.post(
        "/api/jobs",
        json={
            "job_type": "fetch_sent_items",
            "parameters": {"date_from": "20260601", "date_to": "20260630"},
        },
    )
    assert create_response.status_code == 202
    body = create_response.json()
    assert body["status"] == "queued"
    job_id = body["job_id"]

    get_response = client.get(f"/api/jobs/{job_id}")
    assert get_response.status_code == 200
    job = get_response.json()
    assert job["job_id"] == job_id
    assert job["job_type"] == "fetch_sent_items"
    assert job["parameters"]["date_from"] == "20260601"
    assert job["progress_percentage"] is None


def test_list_jobs_includes_created(client: TestClient):
    create_response = client.post("/api/jobs", json={"job_type": "generate_activity_charts"})
    job_id = create_response.json()["job_id"]

    list_response = client.get("/api/jobs", params={"limit": 200})
    assert list_response.status_code == 200
    ids = [job["job_id"] for job in list_response.json()]
    assert job_id in ids


def test_get_job_not_found(client: TestClient):
    response = client.get("/api/jobs/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_create_job_rejects_unknown_job_type(client: TestClient):
    response = client.post("/api/jobs", json={"job_type": "not_a_real_type"})
    assert response.status_code == 422


def test_retry_job_not_found(client: TestClient):
    response = client.post("/api/jobs/00000000-0000-0000-0000-000000000000/retry")
    assert response.status_code == 404


def test_retry_job_conflicts_when_not_failed(client: TestClient):
    create_response = client.post("/api/jobs", json={"job_type": "generate_activity_charts"})
    job_id = create_response.json()["job_id"]

    retry_response = client.post(f"/api/jobs/{job_id}/retry")
    assert retry_response.status_code == 409


def test_health_still_works(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_charts_timeline_still_works(client: TestClient):
    response = client.post(
        "/charts/timeline",
        json={"title": "Prueba", "points": [{"date": "2026-07-01", "count": 3}]},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
