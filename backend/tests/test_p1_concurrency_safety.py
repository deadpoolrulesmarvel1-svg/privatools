"""P1 C7: the html_to_pdf URL-fetch connection cache must be thread-local so
concurrent fetches never share a non-thread-safe http.client connection."""

import threading

from backend.app.services.html_to_pdf_service import _thread_conn_cache


def test_conn_cache_is_thread_local():
    main_cache_id = id(_thread_conn_cache())

    other = {}

    def grab():
        other["id"] = id(_thread_conn_cache())

    t = threading.Thread(target=grab)
    t.start()
    t.join()

    # A different worker thread gets its own cache object…
    assert other["id"] != main_cache_id
    # …and the same thread reuses its own (keep-alive still works per-thread).
    assert id(_thread_conn_cache()) == main_cache_id


def test_thread_conn_cache_returns_a_mutable_dict():
    cache = _thread_conn_cache()
    cache[("https", "example.test", 443)] = object()
    # Same thread, same call → same dict, mutation visible.
    assert ("https", "example.test", 443) in _thread_conn_cache()
