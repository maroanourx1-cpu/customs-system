"""
نقطة تشغيل للإنتاج (Suga / Docker).
بتلفّ البرنامج (app.py) من برّه من غير ما تعدّل فيه حاجة، وبتضيف:
  - ضغط gzip للصفحات و CSS/JS (الصفحات بتتحمل أسرع بكتير)
  - كاش للملفات الثابتة /static/ (ساعة) بدل no-store
  - waitress بعدد threads أكبر للسرعة مع أكتر من مستخدم
"""
import gzip
import os

from app import app  # noqa: E402  (init_db بيشتغل هنا زي ما هو)

COMPRESSIBLE = ("text/", "application/json", "application/javascript", "image/svg+xml")
MIN_SIZE = 600
STATIC_MAX_AGE = int(os.environ.get("STATIC_MAX_AGE", "3600"))


class Speedup:
    def __init__(self, wsgi):
        self.wsgi = wsgi

    def __call__(self, environ, start_response):
        captured = {}

        def sr(status, headers, exc_info=None):
            captured["status"], captured["headers"], captured["exc"] = status, list(headers), exc_info
            return lambda data: None  # write() مش مستخدمة في Flask

        result = self.wsgi(environ, sr)
        status, headers = captured["status"], captured["headers"]
        path = environ.get("PATH_INFO", "")
        hdr = {k.lower(): v for k, v in headers}
        code = status.split(" ", 1)[0]

        # كاش للملفات الثابتة
        if path.startswith("/static/") and code in ("200", "304"):
            headers = [(k, v) for k, v in headers if k.lower() != "cache-control"]
            headers.append(("Cache-Control", f"public, max-age={STATIC_MAX_AGE}"))

        # gzip
        ctype = hdr.get("content-type", "")
        can_gzip = (
            code == "200"
            and "gzip" in environ.get("HTTP_ACCEPT_ENCODING", "")
            and "content-encoding" not in hdr
            and not hdr.get("content-disposition", "").lower().startswith("attachment")
            and ctype.startswith(COMPRESSIBLE)
        )
        if can_gzip:
            try:
                body = b"".join(result)
            finally:
                if hasattr(result, "close"):
                    result.close()
            if len(body) >= MIN_SIZE:
                body = gzip.compress(body, compresslevel=5)
                vary = hdr.get("vary", "")
                headers = [(k, v) for k, v in headers
                           if k.lower() not in ("content-length", "content-encoding", "accept-ranges", "vary")]
                headers.append(("Content-Encoding", "gzip"))
                headers.append(("Content-Length", str(len(body))))
                headers.append(("Vary", (vary + ", " if vary else "") + "Accept-Encoding"))
            start_response(status, headers, captured["exc"])
            return [body]

        start_response(status, headers, captured["exc"])
        return result


application = Speedup(app)

if __name__ == "__main__":
    from waitress import serve

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    threads = int(os.environ.get("THREADS", "8"))
    print(f">> INX System running on {host}:{port} ({threads} threads)")
    serve(application, host=host, port=port, threads=threads, connection_limit=200, channel_timeout=60)
