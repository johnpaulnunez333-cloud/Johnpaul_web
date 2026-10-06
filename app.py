import hmac
import os
import re
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import quote

import psycopg2
import psycopg2.extras
import requests
from flask import (
    Flask,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
)
from werkzeug.utils import secure_filename

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
FILE_BUCKET = os.environ.get("FILE_BUCKET", "files")
COVER_BUCKET = os.environ.get("COVER_BUCKET", "covers")

FILE_EXTENSIONS = {".apk", ".xapk", ".apks", ".obb", ".zip", ".7z", ".rar"}
COVER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
FILE_KINDS = {"apk", "data", "other"}
PACKAGE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")
MAX_ENTRIES = 20

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or os.urandom(32).hex(),
    MAX_CONTENT_LENGTH=int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 12,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    version TEXT NOT NULL DEFAULT '',
    package TEXT NOT NULL DEFAULT '',
    cover TEXT,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    original_name TEXT,
    stored_name TEXT,
    url TEXT,
    size BIGINT NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0
);
"""


class StorageError(Exception):
    pass


class Database:
    def __init__(self):
        self.connection = psycopg2.connect(
            DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor
        )

    def execute(self, sql, params=()):
        cursor = self.connection.cursor()
        cursor.execute(sql, params)
        return cursor

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


def get_db():
    if "db" not in g:
        g.db = Database()
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_storage():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set.")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
    db = Database()
    db.execute(SCHEMA)
    db.commit()
    db.close()


init_storage()


def storage_headers(extra=None):
    headers = {"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY}
    if extra:
        headers.update(extra)
    return headers


def storage_upload(bucket, name, upload):
    stream = upload.stream
    stream.seek(0, 2)
    size = stream.tell()
    stream.seek(0)
    try:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/{bucket}/{quote(name)}",
            headers=storage_headers(
                {
                    "Content-Type": upload.mimetype or "application/octet-stream",
                    "x-upsert": "false",
                }
            ),
            data=stream,
            timeout=900,
        )
    except requests.RequestException:
        raise StorageError("Could not reach the storage service. Try again in a moment.")
    if not response.ok:
        raise StorageError(
            "Storage rejected the file. Free Supabase projects allow up to 50 MB per file. "
            "Use an external download link for larger files."
        )
    return size


def storage_remove(bucket, names):
    names = [name for name in names if name]
    if not names:
        return
    try:
        requests.delete(
            f"{SUPABASE_URL}/storage/v1/object/{bucket}",
            headers=storage_headers({"Content-Type": "application/json"}),
            json={"prefixes": names},
            timeout=60,
        )
    except requests.RequestException:
        pass


def public_url(bucket, name, download_name=None):
    url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{quote(name)}"
    if download_name:
        url += f"?download={quote(download_name)}"
    return url


def discard(uploaded):
    for bucket in {item[0] for item in uploaded}:
        storage_remove(bucket, [item[1] for item in uploaded if item[0] == bucket])


@app.after_request
def add_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("admin"):
            return jsonify(error="Please sign in to continue."), 401
        return view(*args, **kwargs)

    return wrapper


def serialize_file(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "label": row["label"],
        "size": row["size"],
        "external": bool(row["url"]),
        "download_url": f"/download/{row['id']}",
    }


def serialize_game(db, row):
    file_rows = db.execute(
        "SELECT * FROM files WHERE game_id = %s "
        "ORDER BY CASE kind WHEN 'apk' THEN 0 WHEN 'data' THEN 1 ELSE 2 END, id",
        (row["id"],),
    ).fetchall()
    files = [serialize_file(file_row) for file_row in file_rows]
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "version": row["version"],
        "package": row["package"],
        "cover_url": public_url(COVER_BUCKET, row["cover"]) if row["cover"] else None,
        "downloads": row["downloads"],
        "created_at": row["created_at"],
        "total_size": sum(item["size"] for item in files),
        "files": files,
    }


def fetch_game(db, game_id):
    return db.execute("SELECT * FROM games WHERE id = %s", (game_id,)).fetchone()


def read_game_fields():
    title = request.form.get("title", "").strip()
    if not title:
        raise ValueError("Enter a game title.")
    package = request.form.get("package", "").strip()
    if package and not PACKAGE_PATTERN.match(package):
        raise ValueError("The package name looks invalid. Use a format like com.studio.game.")
    return {
        "title": title[:120],
        "description": request.form.get("description", "").strip()[:4000],
        "category": (request.form.get("category", "").strip() or "Other")[:40],
        "version": request.form.get("version", "").strip()[:40],
        "package": package[:150],
    }


def read_cover():
    upload = request.files.get("cover")
    if not upload or not upload.filename:
        return None
    if Path(upload.filename).suffix.lower() not in COVER_EXTENSIONS:
        raise ValueError("Cover images must be PNG, JPG or WEBP.")
    return upload


def save_cover(upload):
    stored_name = f"{uuid.uuid4().hex}{Path(upload.filename).suffix.lower()}"
    storage_upload(COVER_BUCKET, stored_name, upload)
    return stored_name


def parse_entries():
    try:
        count = int(request.form.get("entry_count", "0"))
    except ValueError:
        count = 0
    entries = []
    for index in range(max(0, min(count, MAX_ENTRIES))):
        kind = request.form.get(f"kind_{index}", "apk")
        if kind not in FILE_KINDS:
            kind = "other"
        label = request.form.get(f"label_{index}", "").strip()[:80]
        url = request.form.get(f"url_{index}", "").strip()
        upload = request.files.get(f"file_{index}")
        if upload and upload.filename:
            extension = Path(upload.filename).suffix.lower()
            if extension not in FILE_EXTENSIONS:
                raise ValueError(
                    "Unsupported file type. Allowed types: APK, XAPK, APKS, OBB, ZIP, 7Z and RAR."
                )
            original = secure_filename(upload.filename) or f"file{extension}"
            entries.append(
                {
                    "kind": kind,
                    "label": label or original,
                    "upload": upload,
                    "extension": extension,
                    "original": original,
                    "url": None,
                }
            )
        elif url:
            if not re.match(r"^https?://", url, re.IGNORECASE):
                raise ValueError("Download links must start with http:// or https://.")
            entries.append(
                {
                    "kind": kind,
                    "label": label or "External download",
                    "upload": None,
                    "extension": "",
                    "original": None,
                    "url": url[:1000],
                }
            )
    return entries


def store_entries(db, game_id, entries, uploaded):
    for entry in entries:
        stored_name = None
        size = 0
        if entry["upload"] is not None:
            stored_name = f"{uuid.uuid4().hex}{entry['extension']}"
            size = storage_upload(FILE_BUCKET, stored_name, entry["upload"])
            uploaded.append((FILE_BUCKET, stored_name))
        db.execute(
            "INSERT INTO files (game_id, kind, label, original_name, stored_name, url, size) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (game_id, entry["kind"], entry["label"], entry["original"], stored_name, entry["url"], size),
        )


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/admin")
def admin_page():
    return render_template("admin.html")


@app.get("/api/games")
def list_games():
    query = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    sort = request.args.get("sort", "newest")
    clauses = []
    params = []
    if query:
        clauses.append("(title ILIKE %s OR description ILIKE %s OR package ILIKE %s)")
        like = f"%{query}%"
        params.extend([like, like, like])
    if category and category != "All":
        clauses.append("category = %s")
        params.append(category)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    order = "downloads DESC, id DESC" if sort == "popular" else "id DESC"
    db = get_db()
    rows = db.execute(f"SELECT * FROM games {where} ORDER BY {order}", params).fetchall()
    return jsonify([serialize_game(db, row) for row in rows])


@app.get("/api/games/<int:game_id>")
def get_game(game_id):
    db = get_db()
    row = fetch_game(db, game_id)
    if row is None:
        return jsonify(error="Game not found."), 404
    return jsonify(serialize_game(db, row))


@app.get("/api/categories")
def list_categories():
    rows = get_db().execute("SELECT DISTINCT category FROM games ORDER BY category").fetchall()
    return jsonify([row["category"] for row in rows])


@app.get("/download/<int:file_id>")
def download(file_id):
    db = get_db()
    row = db.execute("SELECT * FROM files WHERE id = %s", (file_id,)).fetchone()
    if row is None:
        abort(404)
    db.execute("UPDATE files SET downloads = downloads + 1 WHERE id = %s", (file_id,))
    if row["kind"] == "apk":
        db.execute("UPDATE games SET downloads = downloads + 1 WHERE id = %s", (row["game_id"],))
    db.commit()
    if row["url"]:
        return redirect(row["url"])
    return redirect(public_url(FILE_BUCKET, row["stored_name"], row["original_name"]))


@app.get("/api/admin/session")
def session_state():
    return jsonify(signed_in=bool(session.get("admin")))


@app.post("/api/admin/login")
def login():
    expected = os.environ.get("ADMIN_PASSWORD", "")
    if not expected:
        return jsonify(error="The admin password is not configured on the server."), 503
    payload = request.get_json(silent=True) or {}
    supplied = str(payload.get("password", ""))
    if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        time.sleep(1)
        return jsonify(error="Incorrect password."), 401
    session["admin"] = True
    session.permanent = True
    return jsonify(ok=True)


@app.post("/api/admin/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/admin/games")
@admin_required
def create_game():
    try:
        fields = read_game_fields()
        cover = read_cover()
        entries = parse_entries()
    except ValueError as error:
        return jsonify(error=str(error)), 400
    if not entries:
        return jsonify(error="Add at least one file or download link."), 400
    db = get_db()
    uploaded = []
    try:
        cover_name = None
        if cover:
            cover_name = save_cover(cover)
            uploaded.append((COVER_BUCKET, cover_name))
        cursor = db.execute(
            "INSERT INTO games (title, description, category, version, package, cover, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                fields["title"],
                fields["description"],
                fields["category"],
                fields["version"],
                fields["package"],
                cover_name,
                datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            ),
        )
        game_id = cursor.fetchone()["id"]
        store_entries(db, game_id, entries, uploaded)
        db.commit()
    except StorageError as error:
        db.rollback()
        discard(uploaded)
        return jsonify(error=str(error)), 502
    except Exception:
        db.rollback()
        discard(uploaded)
        raise
    return jsonify(serialize_game(db, fetch_game(db, game_id))), 201


@app.put("/api/admin/games/<int:game_id>")
@admin_required
def update_game(game_id):
    db = get_db()
    existing = fetch_game(db, game_id)
    if existing is None:
        return jsonify(error="Game not found."), 404
    try:
        fields = read_game_fields()
        cover = read_cover()
        entries = parse_entries()
    except ValueError as error:
        return jsonify(error=str(error)), 400
    uploaded = []
    try:
        cover_name = existing["cover"]
        replaced_cover = None
        if cover:
            replaced_cover = existing["cover"]
            cover_name = save_cover(cover)
            uploaded.append((COVER_BUCKET, cover_name))
        db.execute(
            "UPDATE games SET title = %s, description = %s, category = %s, version = %s, "
            "package = %s, cover = %s WHERE id = %s",
            (
                fields["title"],
                fields["description"],
                fields["category"],
                fields["version"],
                fields["package"],
                cover_name,
                game_id,
            ),
        )
        store_entries(db, game_id, entries, uploaded)
        db.commit()
    except StorageError as error:
        db.rollback()
        discard(uploaded)
        return jsonify(error=str(error)), 502
    except Exception:
        db.rollback()
        discard(uploaded)
        raise
    if replaced_cover:
        storage_remove(COVER_BUCKET, [replaced_cover])
    return jsonify(serialize_game(db, fetch_game(db, game_id)))


@app.delete("/api/admin/games/<int:game_id>")
@admin_required
def delete_game(game_id):
    db = get_db()
    existing = fetch_game(db, game_id)
    if existing is None:
        return jsonify(error="Game not found."), 404
    stored = db.execute("SELECT stored_name FROM files WHERE game_id = %s", (game_id,)).fetchall()
    db.execute("DELETE FROM games WHERE id = %s", (game_id,))
    db.commit()
    storage_remove(FILE_BUCKET, [row["stored_name"] for row in stored])
    storage_remove(COVER_BUCKET, [existing["cover"]])
    return jsonify(ok=True)


@app.delete("/api/admin/files/<int:file_id>")
@admin_required
def delete_file(file_id):
    db = get_db()
    row = db.execute("SELECT * FROM files WHERE id = %s", (file_id,)).fetchone()
    if row is None:
        return jsonify(error="File not found."), 404
    db.execute("DELETE FROM files WHERE id = %s", (file_id,))
    db.commit()
    storage_remove(FILE_BUCKET, [row["stored_name"]])
    return jsonify(ok=True)


@app.errorhandler(413)
def upload_too_large(error):
    return (
        jsonify(
            error="That upload is larger than the server allows. Use an external download link for very large files."
        ),
        413,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
