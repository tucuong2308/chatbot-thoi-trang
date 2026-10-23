"""Hàm dùng chung cho các script nạp dữ liệu (chỉ dùng thư viện chuẩn của Python)."""
import json
import os
import time
import urllib.request
import urllib.error

BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def load_env():
    """Đọc GEMINI_API_KEY từ biến môi trường hoặc file scripts/.env"""
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_file):
        for line in open(env_file, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("Thiếu GEMINI_API_KEY (đặt trong scripts/.env)")
    return key


def gemini(model, method, body, key, retries=5):
    """Gọi Gemini REST; gặp giới hạn lượt gọi (429) thì chờ rồi thử lại."""
    req = urllib.request.Request(
        f"{BASE}/{model}:{method}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-goog-api-key": key},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.load(res)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < retries - 1:
                wait = 2 ** attempt * 5
                print(f"  lỗi {e.code}, chờ {wait}s rồi thử lại")
                time.sleep(wait)
                continue
            raise SystemExit(f"Gemini lỗi {e.code}: {e.read().decode()[:500]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:  # mạng chập chờn / phản hồi quá chậm
            if attempt < retries - 1:
                print(f"  Gemini không phản hồi ({e}), thử lại")
                time.sleep(5)
                continue
            raise SystemExit(f"Gemini không phản hồi: {e}")


def load_admin_key():
    """ADMIN_KEY để gọi /admin/* của Worker: biến môi trường, scripts/.env hoặc .dev.vars"""
    if os.environ.get("ADMIN_KEY"):
        return os.environ["ADMIN_KEY"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for path in (os.path.join(root, "scripts", ".env"), os.path.join(root, ".dev.vars")):
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                if line.startswith("ADMIN_KEY="):
                    return line.strip().split("=", 1)[1]
    raise SystemExit("Thiếu ADMIN_KEY (đặt trong .dev.vars hoặc scripts/.env)")


def post_worker(base_url, path, data, content_type="application/json"):
    """Gửi dữ liệu lên endpoint /admin/* của Worker (VD http://localhost:8787)."""
    body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + path, data=body, method="POST",
        headers={"content-type": content_type, "x-admin-key": load_admin_key()},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Worker lỗi {e.code}: {e.read().decode()[:500]}")
