from app.services.jobs_service import progress_percentage


def test_progress_percentage_none_total():
    assert progress_percentage(0, None) is None


def test_progress_percentage_zero_total():
    assert progress_percentage(0, 0) is None


def test_progress_percentage_partial():
    assert progress_percentage(245, 930) == 26.34


def test_progress_percentage_complete():
    assert progress_percentage(10, 10) == 100.0
