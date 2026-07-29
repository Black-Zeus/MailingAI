from app.services.cases_service import _normalize_subject


def test_normalize_subject_strips_single_prefix():
    assert _normalize_subject("RE: Fondos Concursables 2026") == "Fondos Concursables 2026"


def test_normalize_subject_strips_repeated_prefixes():
    assert _normalize_subject("RE: RE: FWD: Seguimiento ISO 27001") == "Seguimiento ISO 27001"


def test_normalize_subject_no_prefix():
    assert _normalize_subject("Cierre de proyecto") == "Cierre de proyecto"


def test_normalize_subject_none():
    assert _normalize_subject(None) == ""


def test_normalize_subject_case_insensitive():
    assert _normalize_subject("re: minuscula") == "minuscula"
