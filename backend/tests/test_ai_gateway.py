from app.services.ai.gateway import _format_sender


def test_format_sender_name_and_address():
    assert _format_sender("Victor Soto", "vsoto@tecnocomp.cl") == "Victor Soto (vsoto@tecnocomp.cl)"


def test_format_sender_address_only():
    assert _format_sender(None, "vsoto@tecnocomp.cl") == "vsoto@tecnocomp.cl"


def test_format_sender_name_only():
    assert _format_sender("Victor Soto", None) == "Victor Soto"


def test_format_sender_none():
    assert _format_sender(None, None) == "desconocido"


def test_format_sender_name_equals_address_skips_duplication():
    assert _format_sender("vsoto@tecnocomp.cl", "vsoto@tecnocomp.cl") == "vsoto@tecnocomp.cl"
