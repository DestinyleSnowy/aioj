import base64
import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text

try:
    import yaml
except Exception:
    yaml = None


def now_utc():
    return datetime.now(timezone.utc)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


DATABASE_URL = env("DATABASE_URL")
if not DATABASE_URL:
    pg_user = env("POSTGRES_USER", "aioj")
    pg_password = env("POSTGRES_PASSWORD", "aioj")
    pg_db = env("POSTGRES_DB", "aioj")
    DATABASE_URL = f"postgresql+psycopg://{pg_user}:{pg_password}@postgres:5432/{pg_db}"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

S3_ENDPOINT = env("S3_ENDPOINT", env("MINIO_ENDPOINT", "http://minio:9000"))
S3_ACCESS_KEY = env("S3_ACCESS_KEY", env("MINIO_ROOT_USER", "aiojadmin"))
S3_SECRET_KEY = env("S3_SECRET_KEY", env("MINIO_ROOT_PASSWORD", "aiojpassword"))
S3_BUCKET_PROBLEMS = env("S3_BUCKET_PROBLEMS", "aioj-problems")
S3_BUCKET_SUBMISSIONS = env("S3_BUCKET_SUBMISSIONS", "aioj-submissions")
S3_BUCKET_LOGS = env("S3_BUCKET_LOGS", "aioj-logs")

TOKEN_SECRET = env("TOKEN_SECRET", env("SECRET_KEY", env("MINIO_ROOT_PASSWORD", "aioj-dev-secret"))).encode("utf-8")
ADMIN_USERNAME = env("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "adminadmin")
ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@example.com")

app = FastAPI(title="AIOJ API", version="scorer-v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
    )


def ensure_bucket(name: str):
    s3 = s3_client()
    try:
        s3.head_bucket(Bucket=name)
    except ClientError:
        s3.create_bucket(Bucket=name)


def put_text(bucket: str, key: str, body: str, content_type: str = "text/plain; charset=utf-8"):
    s3_client().put_object(Bucket=bucket, Key=key, Body=body.encode("utf-8"), ContentType=content_type)


def get_text(bucket: str, key: str) -> str:
    obj = s3_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read().decode("utf-8", errors="replace")


def put_bytes(bucket: str, key: str, body: bytes, content_type: str = "application/octet-stream"):
    s3_client().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)


def get_bytes(bucket: str, key: str) -> bytes:
    obj = s3_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"pbkdf2$200000${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False

    parts = stored.split("$")
    if len(parts) == 4 and parts[0] == "pbkdf2":
        try:
            rounds = int(parts[1])
            salt = parts[2]
            expected = parts[3]
            digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds).hex()
            return hmac.compare_digest(digest, expected)
        except Exception:
            return False

    if len(parts) == 3 and parts[0] == "sha256":
        salt = parts[1]
        expected = parts[2]
        digest = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, expected)

    return False


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64url(data: str) -> bytes:
    data += "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data.encode("ascii"))


def make_token(user_id: int, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": int(time.time()),
    }
    body = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(TOKEN_SECRET, body.encode("ascii"), hashlib.sha256).digest()
    return body + "." + b64url(sig)


def verify_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".", 1)
        expected = b64url(hmac.new(TOKEN_SECRET, body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(unb64url(body))
        return payload
    except Exception:
        return None


def get_optional_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    payload = verify_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        return None
    with engine.connect() as conn:
        row = conn.execute(
            text("select id, username, email, role from users where id = :id"),
            {"id": payload["sub"]},
        ).mappings().first()
    return dict(row) if row else None


def require_user(user=Depends(get_optional_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


def safe_slug(s: str) -> str:
    import re
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}", s or ""):
        raise HTTPException(status_code=400, detail="Invalid slug")
    return s


def parse_yaml(data: bytes) -> dict:
    if yaml is None:
        raise HTTPException(status_code=500, detail="PyYAML is not installed")
    try:
        obj = yaml.safe_load(data.decode("utf-8")) or {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid problem.yaml: {e}")
    if not isinstance(obj, dict):
        raise HTTPException(status_code=400, detail="problem.yaml must be a mapping")
    return obj


def safe_extract_zip_bytes(zip_bytes: bytes, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for info in z.infolist():
            target = (dest / info.filename).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise HTTPException(status_code=400, detail=f"Unsafe zip path: {info.filename}")
        z.extractall(dest)


def db_init():
    ddl = """
    create table if not exists users (
        id bigserial primary key,
        username text unique not null,
        email text unique,
        password_hash text not null,
        role text not null default 'USER',
        created_at timestamptz not null default now()
    );

    create table if not exists problems (
        id bigserial primary key,
        slug text unique not null,
        title text not null,
        statement_md text not null default '',
        metric text not null default 'accuracy',
        higher_is_better boolean not null default true,
        time_limit_sec int not null default 60,
        memory_limit_mb int not null default 2048,
        cpu_count int not null default 2,
        output_limit_mb int not null default 64,
        status text not null default 'DRAFT',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    );

    create table if not exists problem_versions (
        id bigserial primary key,
        problem_id bigint not null references problems(id) on delete cascade,
        version text not null,
        statement_md text not null default '',
        test_input_object_key text not null,
        label_object_key text not null,
        sample_submission_object_key text not null,
        scorer_object_key text,
        runner_image text not null default 'aioj-python-basic:latest',
        run_command jsonb not null default '["python","/workspace/predict.py","--input","/input/test.csv","--output","/output/submission.csv"]',
        created_at timestamptz not null default now(),
        unique(problem_id, version)
    );

    create table if not exists submissions (
        id bigserial primary key,
        user_id bigint references users(id),
        problem_id bigint not null references problems(id),
        problem_version_id bigint not null references problem_versions(id),
        status text not null default 'QUEUED',
        source_object_key text not null,
        output_object_key text,
        log_object_key text,
        public_score double precision,
        private_score double precision,
        metrics jsonb,
        error_message text,
        runtime_ms int,
        memory_peak_mb int,
        created_at timestamptz not null default now(),
        judged_at timestamptz
    );

    create table if not exists judge_nodes (
        id bigserial primary key,
        name text unique not null,
        token_hash text not null,
        tags text[] not null default '{}',
        max_parallel int not null default 1,
        status text not null default 'OFFLINE',
        last_heartbeat_at timestamptz,
        created_at timestamptz not null default now()
    );

    create table if not exists judge_jobs (
        id bigserial primary key,
        submission_id bigint not null references submissions(id) on delete cascade,
        problem_id bigint not null references problems(id),
        required_tags text[] not null default '{}',
        status text not null default 'PENDING',
        attempt int not null default 0,
        claimed_by bigint references judge_nodes(id),
        claimed_at timestamptz,
        started_at timestamptz,
        finished_at timestamptz,
        run_spec jsonb not null default '{}',
        created_at timestamptz not null default now()
    );

    create table if not exists leaderboard_entries (
        id bigserial primary key,
        problem_id bigint not null references problems(id) on delete cascade,
        user_id bigint references users(id),
        username text not null default 'anonymous',
        best_submission_id bigint references submissions(id),
        public_score double precision,
        private_score double precision,
        updated_at timestamptz not null default now()
    );

    create index if not exists judge_jobs_status_idx on judge_jobs(status, id);
    create index if not exists submissions_problem_idx on submissions(problem_id, created_at desc);
    create index if not exists leaderboard_problem_idx on leaderboard_entries(problem_id, public_score desc);
    """

    alters = [
        "alter table users add column if not exists email text",
        "alter table users add column if not exists password_hash text",
        "alter table users add column if not exists role text not null default 'USER'",
        "alter table problems add column if not exists statement_md text not null default ''",
        "alter table problems add column if not exists metric text not null default 'accuracy'",
        "alter table problems add column if not exists higher_is_better boolean not null default true",
        "alter table problems add column if not exists time_limit_sec int not null default 60",
        "alter table problems add column if not exists memory_limit_mb int not null default 2048",
        "alter table problems add column if not exists cpu_count int not null default 2",
        "alter table problems add column if not exists output_limit_mb int not null default 64",
        "alter table problems add column if not exists status text not null default 'DRAFT'",
        "alter table problems add column if not exists updated_at timestamptz not null default now()",
        "alter table problem_versions add column if not exists statement_md text not null default ''",
        "alter table problem_versions add column if not exists scorer_object_key text",
        "alter table problem_versions add column if not exists runner_image text not null default 'aioj-python-basic:latest'",
        "alter table problem_versions add column if not exists run_command jsonb not null default '[\"python\",\"/workspace/predict.py\",\"--input\",\"/input/test.csv\",\"--output\",\"/output/submission.csv\"]'",
        "alter table submissions add column if not exists metrics jsonb",
        "alter table submissions add column if not exists memory_peak_mb int",
        "alter table submissions add column if not exists judged_at timestamptz",
    ]

    with engine.begin() as conn:
        conn.execute(text(ddl))
        for sql in alters:
            try:
                conn.execute(text(sql))
            except Exception:
                pass


def ensure_admin():
    pwd = hash_password(ADMIN_PASSWORD)
    with engine.begin() as conn:
        row = conn.execute(
            text("select id from users where username = :username"),
            {"username": ADMIN_USERNAME},
        ).mappings().first()

        if row:
            conn.execute(
                text("""
                    update users
                    set role = 'ADMIN',
                        password_hash = :password_hash,
                        email = coalesce(email, :email)
                    where username = :username
                """),
                {"username": ADMIN_USERNAME, "password_hash": pwd, "email": ADMIN_EMAIL},
            )
        else:
            conn.execute(
                text("""
                    insert into users(username, email, password_hash, role)
                    values (:username, :email, :password_hash, 'ADMIN')
                """),
                {"username": ADMIN_USERNAME, "email": ADMIN_EMAIL, "password_hash": pwd},
            )


@app.on_event("startup")
def startup():
    db_init()
    init_contest_full_v6_features()
    init_contest_clarification_features()
    init_contest_scoreboard_features()
    init_contest_ops_features()
    init_contest_participant_features()
    init_contest_features()
    init_user_admin_features()
    ensure_bucket(S3_BUCKET_PROBLEMS)
    ensure_bucket(S3_BUCKET_SUBMISSIONS)
    ensure_bucket(S3_BUCKET_LOGS)
    ensure_admin()


@app.get("/health")
def health():
    return {"ok": True, "version": "scorer-v1"}


@app.post("/api/auth/register")
def register(payload: dict):
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip() or None
    password = payload.get("password") or ""

    if not username or len(username) > 50:
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    if not get_setting_bool("registration_enabled", True):
        raise HTTPException(status_code=403, detail="Registration is disabled")

    with engine.begin() as conn:
        try:
            row = conn.execute(
                text("""
                    insert into users(username, email, password_hash, role)
                    values (:username, :email, :password_hash, 'USER')
                    returning id, username, email, role
                """),
                {"username": username, "email": email, "password_hash": hash_password(password)},
            ).mappings().first()
        except Exception:
            raise HTTPException(status_code=400, detail="Username or email already exists")

    user = dict(row)
    return {"token": make_token(user["id"], user["username"], user["role"]), "user": user}


@app.post("/api/auth/login")
def login(payload: dict):
    key = (payload.get("username_or_email") or "").strip()
    password = payload.get("password") or ""

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                select id, username, email, password_hash, role, coalesce(is_disabled, false) as is_disabled
                from users
                where username = :key or email = :key
                limit 1
            """),
            {"key": key},
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        if bool(row["is_disabled"]):
            raise HTTPException(status_code=403, detail="User is disabled")

        if not verify_password(password, row["password_hash"]):
            if row["username"] == ADMIN_USERNAME and password == ADMIN_PASSWORD:
                conn.execute(
                    text("update users set password_hash = :h, role = 'ADMIN' where id = :id"),
                    {"h": hash_password(password), "id": row["id"]},
                )
            else:
                raise HTTPException(status_code=401, detail="Invalid username or password")

    user = {"id": row["id"], "username": row["username"], "email": row["email"], "role": row["role"]}
    return {"token": make_token(user["id"], user["username"], user["role"]), "user": user}


@app.get("/api/problems")
def list_problems():
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select id, slug, title, metric, higher_is_better, time_limit_sec,
                       memory_limit_mb, cpu_count, status, created_at
                from problems
                where status = 'PUBLIC'
                order by created_at desc, id desc
            """)
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


def latest_problem_version(conn, slug: str, public_only: bool = True):
    status_filter = "and p.status = 'PUBLIC'" if public_only else ""
    return conn.execute(
        text(f"""
            select
                p.id as problem_id,
                p.slug,
                p.title,
                p.metric,
                p.higher_is_better,
                p.time_limit_sec,
                p.memory_limit_mb,
                p.cpu_count,
                p.output_limit_mb,
                p.status,
                coalesce(nullif(pv.statement_md, ''), p.statement_md) as statement_md,
                pv.id as problem_version_id,
                pv.version,
                pv.test_input_object_key,
                pv.label_object_key,
                pv.sample_submission_object_key,
                pv.scorer_object_key,
                pv.runner_image,
                pv.run_command
            from problems p
            join problem_versions pv on pv.problem_id = p.id
            where p.slug = :slug
              {status_filter}
            order by pv.created_at desc, pv.id desc
            limit 1
        """),
        {"slug": slug},
    ).mappings().first()


@app.get("/api/problems/{slug}")
def get_problem(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    d = dict(row)
    d.pop("test_input_object_key", None)
    d.pop("label_object_key", None)
    d.pop("sample_submission_object_key", None)
    d.pop("scorer_object_key", None)
    return d


@app.get("/api/problems/{slug}/sample-submission")
def get_problem_sample_submission(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    content = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
    return {
        "slug": slug,
        "filename": "sample_submission.csv",
        "content_type": "text/csv",
        "content": content,
    }


@app.post("/api/problems/{slug}/submissions")
async def create_submission(slug: str, file: UploadFile = File(...), contest_slug: str | None = Form(None), user=Depends(get_optional_user)):

    contest_id = None
    if contest_slug:
        with engine.connect() as conn:
            contest = conn.execute(
                text("select * from contests where slug = :slug and status = 'PUBLIC'"),
                {"slug": contest_slug},
            ).mappings().first()

            if not contest:
                raise HTTPException(status_code=404, detail="Contest not found")

            now = datetime.now(timezone.utc)
            if contest["start_at"] and now < contest["start_at"]:
                raise HTTPException(status_code=403, detail="Contest has not started")
            if contest["end_at"] and now > contest["end_at"]:
                raise HTTPException(status_code=403, detail="Contest has ended")

            member = conn.execute(
                text("select 1 from contest_problems cp join problems p on p.id = cp.problem_id where cp.contest_id = :contest_id and p.slug = :problem_slug"),
                {"contest_id": contest["id"], "problem_slug": slug},
            ).first()

            if not member:
                raise HTTPException(status_code=400, detail="Problem is not in this contest")

            if not user:
                raise HTTPException(status_code=401, detail="Login required to submit in contest")

            participant = conn.execute(
                text("select 1 from contest_participants where contest_id = :contest_id and user_id = :user_id and coalesce(status, 'ACCEPTED') = 'ACCEPTED'"),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).first()

            if not participant:
                raise HTTPException(status_code=403, detail="Join contest before submitting")

            contest_id = contest["id"]

    slug = safe_slug(slug)
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload source.zip")

    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="source.zip too large")

    with engine.begin() as conn:
        pv = latest_problem_version(conn, slug, public_only=True)
        if not pv:
            raise HTTPException(status_code=404, detail="Problem not found")

        source_key = "pending/source.zip"
        output_key = "pending/output/submission.csv"
        log_key = "pending/logs/run.log"

        sub = conn.execute(
            text("""
                insert into submissions (
                    user_id, problem_id, problem_version_id, status,
                    source_object_key, output_object_key, log_object_key
                )
                values (
                    :user_id, :problem_id, :problem_version_id, 'QUEUED',
                    :source_object_key, :output_object_key, :log_object_key
                )
                returning id
            """),
            {
                "user_id": user["id"] if user else None,
                "problem_id": pv["problem_id"],
                "problem_version_id": pv["problem_version_id"],
                "source_object_key": source_key,
                "output_object_key": output_key,
                "log_object_key": log_key,
            },
        ).mappings().first()

        submission_id = sub["id"]
        source_key = f"submissions/{submission_id}/source/source.zip"
        output_key = f"submissions/{submission_id}/output/submission.csv"
        log_key = f"submissions/{submission_id}/logs/run.log"

        put_bytes(S3_BUCKET_SUBMISSIONS, source_key, data, "application/zip")

        conn.execute(
            text("""
                update submissions
                set source_object_key = :source_object_key,
                    output_object_key = :output_object_key,
                    log_object_key = :log_object_key
                where id = :id
            """),
            {
                "id": submission_id,
                "source_object_key": source_key,
                "output_object_key": output_key,
                "log_object_key": log_key,
            },
        )

        run_spec = {
            "submission_id": submission_id,
            "problem_slug": pv["slug"],
            "problem_version": pv["version"],
            "runner_image": pv["runner_image"],
            "run_command": pv["run_command"],
            "limits": {
                "cpu_count": pv["cpu_count"],
                "time_limit_sec": pv["time_limit_sec"],
                "memory_limit_mb": pv["memory_limit_mb"],
                "output_limit_mb": pv["output_limit_mb"],
            },
            "source_bucket": S3_BUCKET_SUBMISSIONS,
            "source_object_key": source_key,
            "output_bucket": S3_BUCKET_SUBMISSIONS,
            "output_object_key": output_key,
            "log_bucket": S3_BUCKET_LOGS,
            "log_object_key": log_key,
            "test_input_bucket": S3_BUCKET_PROBLEMS,
            "test_input_object_key": pv["test_input_object_key"],
        }

        job = conn.execute(
            text("""
                insert into judge_jobs(submission_id, problem_id, status, run_spec)
                values (:submission_id, :problem_id, 'PENDING', cast(:run_spec as jsonb))
                returning id
            """),
            {
                "submission_id": submission_id,
                "problem_id": pv["problem_id"],
                "run_spec": json.dumps(run_spec),
            },
        ).mappings().first()


    if contest_id is not None:
        with engine.begin() as conn:
            conn.execute(
                text("update submissions set contest_id = :contest_id where id = :submission_id"),
                {"contest_id": contest_id, "submission_id": submission_id},
            )

    return {"ok": True, "submission_id": submission_id, "judge_job_id": job["id"], "status": "QUEUED"}


@app.get("/api/submissions/{submission_id}")
def get_submission(submission_id: int, user=Depends(get_optional_user)):
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                select s.*, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                where s.id = :id
            """),
            {"id": submission_id},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    d = dict(row)
    if d["user_id"] is not None and (not user or (user["role"] != "ADMIN" and user["id"] != d["user_id"])):
        raise HTTPException(status_code=403, detail="Forbidden")

    return d


@app.get("/api/problems/{slug}/submissions")
def list_problem_submissions(slug: str, user=Depends(get_optional_user)):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        problem = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        if user and user["role"] == "ADMIN":
            where = "s.problem_id = :problem_id"
            params = {"problem_id": problem["id"]}
        elif user:
            where = "s.problem_id = :problem_id and s.user_id = :user_id"
            params = {"problem_id": problem["id"], "user_id": user["id"]}
        else:
            where = "s.problem_id = :problem_id and s.user_id is null"
            params = {"problem_id": problem["id"]}

        rows = conn.execute(
            text(f"""
                select s.id, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                where {where}
                order by s.created_at desc, s.id desc
                limit 100
            """),
            params,
        ).mappings().all()

    return {"items": [dict(r) for r in rows]}


@app.get("/api/my/submissions")
def my_submissions(user=Depends(require_user)):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select s.id, p.slug as problem_slug, u.username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                join users u on u.id = s.user_id
                where s.user_id = :user_id
                order by s.created_at desc, s.id desc
                limit 100
            """),
            {"user_id": user["id"]},
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@app.get("/api/admin/submissions/recent")
def admin_recent_submissions(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select s.id, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                order by s.created_at desc, s.id desc
                limit 100
            """)
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@app.get("/api/submissions/{submission_id}/log")
def submission_log(submission_id: int, user=Depends(get_optional_user)):
    sub = get_submission(submission_id, user)
    try:
        log = get_text(S3_BUCKET_LOGS, sub["log_object_key"])
    except Exception:
        log = ""
    return {"submission": sub, "log": log}


@app.get("/api/problems/{slug}/leaderboard")
def leaderboard(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        problem = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        rows = conn.execute(
            text("""
                select row_number() over (
                          order by le.public_score desc nulls last, le.updated_at asc
                       ) as rank,
                       le.user_id,
                       le.username,
                       le.best_submission_id,
                       le.public_score,
                       le.private_score,
                       le.updated_at
                from leaderboard_entries le
                where le.problem_id = :problem_id
                order by rank
                limit 100
            """),
            {"problem_id": problem["id"]},
        ).mappings().all()

    return {"problem_slug": slug, "items": [dict(r) for r in rows]}


@app.get("/api/admin/problems")
def admin_problems(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select p.id, p.slug, p.title, p.status,
                       count(pv.id) as versions,
                       max(pv.created_at) as latest_version_at
                from problems p
                left join problem_versions pv on pv.problem_id = p.id
                group by p.id
                order by p.created_at desc, p.id desc
            """)
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/admin/problems/{slug}/status")
def admin_problem_status(slug: str, payload: dict, user=Depends(require_admin)):
    slug = safe_slug(slug)
    status = payload.get("status")
    if status not in {"PUBLIC", "DRAFT", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update problems
                set status = :status, updated_at = now()
                where slug = :slug
                returning slug, status
            """),
            {"slug": slug, "status": status},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    return {"ok": True, **dict(row)}


@app.post("/api/admin/problems/import")
async def import_problem(file: UploadFile = File(...), user=Depends(require_admin)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload problem.zip")

    data = await file.read()
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="problem.zip too large")

    with tempfile.TemporaryDirectory(prefix="aioj_problem_") as td:
        root = Path(td)
        safe_extract_zip_bytes(data, root)

        problem_yaml = root / "problem.yaml"
        statement = root / "statement.md"
        private_test = root / "private" / "test.csv"
        private_labels = root / "private" / "labels.csv"
        sample_submission = root / "public" / "sample_submission.csv"
        scorer = root / "scorer.py"

        missing = [str(p.relative_to(root)) for p in [problem_yaml, statement, private_test, private_labels, sample_submission] if not p.exists()]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing files: {', '.join(missing)}")

        cfg = parse_yaml(problem_yaml.read_bytes())
        slug = safe_slug(str(cfg.get("slug") or ""))
        title = str(cfg.get("title") or slug)
        metric = str(cfg.get("metric") or "accuracy")
        higher_is_better = bool(cfg.get("higher_is_better", True))
        time_limit_sec = int(cfg.get("time_limit_sec", 60))
        memory_limit_mb = int(cfg.get("memory_limit_mb", 2048))
        cpu_count = int(cfg.get("cpu_count", 2))
        output_limit_mb = int(cfg.get("output_limit_mb", 64))
        runner_image = str(cfg.get("runner_image") or "aioj-python-basic:latest")
        run_command = cfg.get("run_command") or ["python", "/workspace/predict.py", "--input", "/input/test.csv", "--output", "/output/submission.csv"]
        if not isinstance(run_command, list) or not all(isinstance(x, str) for x in run_command):
            raise HTTPException(status_code=400, detail="run_command must be a list of strings")

        statement_md = statement.read_text(encoding="utf-8", errors="replace")
        status = str(cfg.get("status") or "PUBLIC").upper()
        if status not in {"PUBLIC", "DRAFT", "ARCHIVED"}:
            status = "DRAFT"

        with engine.begin() as conn:
            existing = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
            if existing:
                problem_id = existing["id"]
                conn.execute(
                    text("""
                        update problems
                        set title = :title,
                            statement_md = :statement_md,
                            metric = :metric,
                            higher_is_better = :higher_is_better,
                            time_limit_sec = :time_limit_sec,
                            memory_limit_mb = :memory_limit_mb,
                            cpu_count = :cpu_count,
                            output_limit_mb = :output_limit_mb,
                            status = :status,
                            updated_at = now()
                        where id = :id
                    """),
                    {
                        "id": problem_id,
                        "title": title,
                        "statement_md": statement_md,
                        "metric": metric,
                        "higher_is_better": higher_is_better,
                        "time_limit_sec": time_limit_sec,
                        "memory_limit_mb": memory_limit_mb,
                        "cpu_count": cpu_count,
                        "output_limit_mb": output_limit_mb,
                        "status": status,
                    },
                )
            else:
                row = conn.execute(
                    text("""
                        insert into problems(
                            slug, title, statement_md, metric, higher_is_better,
                            time_limit_sec, memory_limit_mb, cpu_count, output_limit_mb, status
                        )
                        values (
                            :slug, :title, :statement_md, :metric, :higher_is_better,
                            :time_limit_sec, :memory_limit_mb, :cpu_count, :output_limit_mb, :status
                        )
                        returning id
                    """),
                    {
                        "slug": slug,
                        "title": title,
                        "statement_md": statement_md,
                        "metric": metric,
                        "higher_is_better": higher_is_better,
                        "time_limit_sec": time_limit_sec,
                        "memory_limit_mb": memory_limit_mb,
                        "cpu_count": cpu_count,
                        "output_limit_mb": output_limit_mb,
                        "status": status,
                    },
                ).mappings().first()
                problem_id = row["id"]

            next_num = conn.execute(
                text("select count(*) + 1 as n from problem_versions where problem_id = :problem_id"),
                {"problem_id": problem_id},
            ).mappings().first()["n"]
            version = str(cfg.get("version") or f"v{next_num}")

            prefix = f"problems/{slug}/{version}"
            test_key = f"{prefix}/private/test.csv"
            label_key = f"{prefix}/private/labels.csv"
            sample_key = f"{prefix}/public/sample_submission.csv"
            scorer_key = f"{prefix}/scorer.py" if scorer.exists() else None

            put_bytes(S3_BUCKET_PROBLEMS, test_key, private_test.read_bytes(), "text/csv")
            put_bytes(S3_BUCKET_PROBLEMS, label_key, private_labels.read_bytes(), "text/csv")
            put_bytes(S3_BUCKET_PROBLEMS, sample_key, sample_submission.read_bytes(), "text/csv")
            if scorer.exists():
                put_bytes(S3_BUCKET_PROBLEMS, scorer_key, scorer.read_bytes(), "text/x-python")

            pv = conn.execute(
                text("""
                    insert into problem_versions (
                        problem_id, version, statement_md, test_input_object_key,
                        label_object_key, sample_submission_object_key, scorer_object_key,
                        runner_image, run_command
                    )
                    values (
                        :problem_id, :version, :statement_md, :test_input_object_key,
                        :label_object_key, :sample_submission_object_key, :scorer_object_key,
                        :runner_image, cast(:run_command as jsonb)
                    )
                    returning id
                """),
                {
                    "problem_id": problem_id,
                    "version": version,
                    "statement_md": statement_md,
                    "test_input_object_key": test_key,
                    "label_object_key": label_key,
                    "sample_submission_object_key": sample_key,
                    "scorer_object_key": scorer_key,
                    "runner_image": runner_image,
                    "run_command": json.dumps(run_command),
                },
            ).mappings().first()

    return {
        "ok": True,
        "slug": slug,
        "status": status,
        "version": version,
        "problem_version_id": pv["id"],
        "custom_scorer": bool(scorer_key),
    }


def default_accuracy_score(prediction_csv: str, label_csv: str) -> dict:
    pred_reader = csv.DictReader(io.StringIO(prediction_csv))
    label_reader = csv.DictReader(io.StringIO(label_csv))

    if pred_reader.fieldnames != ["id", "prediction"]:
        raise ValueError("Prediction CSV must have columns exactly: id,prediction")
    if "id" not in (label_reader.fieldnames or []) or "label" not in (label_reader.fieldnames or []):
        raise ValueError("Label CSV must contain id,label columns")

    predictions = {}
    for row in pred_reader:
        predictions[str(row["id"])] = str(row["prediction"])

    labels = []
    for row in label_reader:
        labels.append({
            "id": str(row["id"]),
            "label": str(row["label"]),
            "split": str(row.get("split", "private") or "private").lower(),
        })

    if not labels:
        raise ValueError("Label CSV is empty")

    missing = [r["id"] for r in labels if r["id"] not in predictions]
    if missing:
        raise ValueError(f"Missing predictions for ids: {', '.join(missing[:10])}")

    def acc(rows):
        if not rows:
            return None, 0, 0
        correct = sum(1 for r in rows if predictions[r["id"]] == r["label"])
        return correct / len(rows), correct, len(rows)

    public_rows = [r for r in labels if r["split"] == "public"]
    private_rows = [r for r in labels if r["split"] != "public"]
    all_rows = labels

    public_score, public_correct, public_total = acc(public_rows)
    private_score, private_correct, private_total = acc(private_rows)
    total_score, total_correct, total_total = acc(all_rows)

    if public_score is None:
        public_score = total_score
    if private_score is None:
        private_score = total_score

    return {
        "public_score": public_score,
        "private_score": private_score,
        "metrics": {
            "metric": "accuracy",
            "public_accuracy": public_score,
            "private_accuracy": private_score,
            "total_accuracy": total_score,
            "public_correct": public_correct,
            "public_total": public_total,
            "private_correct": private_correct,
            "private_total": private_total,
            "total_correct": total_correct,
            "total_total": total_total,
        },
    }


def run_custom_scorer(scorer_code: str, prediction_csv: str, label_csv: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="aioj_scorer_") as td:
        root = Path(td)
        (root / "scorer.py").write_text(scorer_code, encoding="utf-8")
        (root / "prediction.csv").write_text(prediction_csv, encoding="utf-8")
        (root / "labels.csv").write_text(label_csv, encoding="utf-8")

        runner = root / "run_scorer.py"
        runner.write_text(
            """
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("scorer", "scorer.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if not hasattr(mod, "score"):
    raise RuntimeError("scorer.py must define score(prediction_csv, label_csv)")

result = mod.score(str(Path("prediction.csv").resolve()), str(Path("labels.csv").resolve()))
if not isinstance(result, dict):
    raise RuntimeError("score() must return a dict")

print(json.dumps(result, ensure_ascii=False))
""".strip(),
            encoding="utf-8",
        )

        proc = subprocess.run(
            ["python", str(runner)],
            cwd=str(root),
            text=True,
            capture_output=True,
            timeout=20,
        )

        if proc.returncode != 0:
            raise ValueError(f"scorer.py failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")

        try:
            data = json.loads(proc.stdout)
        except Exception as e:
            raise ValueError(f"scorer.py did not output valid JSON: {e}\nOutput:\n{proc.stdout}")

    if "public_score" not in data or "private_score" not in data:
        raise ValueError("scorer.py result must contain public_score and private_score")

    metrics = data.get("metrics")
    if metrics is None:
        metrics = {}
    if not isinstance(metrics, dict):
        raise ValueError("metrics must be a dict")

    return {
        "public_score": float(data["public_score"]),
        "private_score": float(data["private_score"]),
        "metrics": metrics,
    }


def rebuild_leaderboard(conn, problem_id: int):
    problem = conn.execute(
        text("select higher_is_better from problems where id = :id"),
        {"id": problem_id},
    ).mappings().first()

    higher = True if not problem else problem["higher_is_better"]
    order_op = ">" if higher else "<"

    rows = conn.execute(
        text("""
            select s.id, s.user_id, coalesce(u.username, 'anonymous') as username,
                   s.public_score, s.private_score, s.created_at
            from submissions s
            left join users u on u.id = s.user_id
            where s.problem_id = :problem_id
              and s.status = 'ACCEPTED'
              and s.public_score is not null
            order by s.created_at asc, s.id asc
        """),
        {"problem_id": problem_id},
    ).mappings().all()

    best = {}
    for row in rows:
        key = str(row["user_id"]) if row["user_id"] is not None else "anonymous"
        old = best.get(key)
        if old is None:
            best[key] = row
            continue
        if higher:
            if row["public_score"] > old["public_score"]:
                best[key] = row
        else:
            if row["public_score"] < old["public_score"]:
                best[key] = row

    conn.execute(text("delete from leaderboard_entries where problem_id = :problem_id"), {"problem_id": problem_id})

    for row in best.values():
        conn.execute(
            text("""
                insert into leaderboard_entries (
                    problem_id, user_id, username, best_submission_id,
                    public_score, private_score, updated_at
                )
                values (
                    :problem_id, :user_id, :username, :best_submission_id,
                    :public_score, :private_score, now()
                )
            """),
            {
                "problem_id": problem_id,
                "user_id": row["user_id"],
                "username": row["username"],
                "best_submission_id": row["id"],
                "public_score": row["public_score"],
                "private_score": row["private_score"],
            },
        )


def evaluate_submission(conn, submission_id: int):
    row = conn.execute(
        text("""
            select
                s.id,
                s.problem_id,
                s.output_object_key,
                pv.label_object_key,
                pv.scorer_object_key,
                p.metric
            from submissions s
            join problem_versions pv on pv.id = s.problem_version_id
            join problems p on p.id = s.problem_id
            where s.id = :id
        """),
        {"id": submission_id},
    ).mappings().first()

    if not row:
        raise ValueError("Submission not found")
    if not row["output_object_key"]:
        raise ValueError("Submission has no output object")

    prediction_csv = get_text(S3_BUCKET_SUBMISSIONS, row["output_object_key"])
    label_csv = get_text(S3_BUCKET_PROBLEMS, row["label_object_key"])

    if row["scorer_object_key"]:
        scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
        result = run_custom_scorer(scorer_code, prediction_csv, label_csv)
        result["metrics"].setdefault("metric", row["metric"])
        result["metrics"].setdefault("scorer", "custom")
    else:
        result = default_accuracy_score(prediction_csv, label_csv)
        result["metrics"].setdefault("scorer", "default_accuracy")

    conn.execute(
        text("""
            update submissions
            set status = 'ACCEPTED',
                public_score = :public_score,
                private_score = :private_score,
                metrics = cast(:metrics as jsonb),
                error_message = null,
                judged_at = now()
            where id = :id
        """),
        {
            "id": submission_id,
            "public_score": result["public_score"],
            "private_score": result["private_score"],
            "metrics": json.dumps(result["metrics"]),
        },
    )

    rebuild_leaderboard(conn, row["problem_id"])


@app.post("/api/dev/judge/claim")
def dev_judge_claim():
    node_name = env("JUDGE_NODE_NAME", "local-worker")

    with engine.begin() as conn:
        node = conn.execute(
            text("""
                insert into judge_nodes(name, token_hash, status, last_heartbeat_at)
                values (:name, '', 'ONLINE', now())
                on conflict (name)
                do update set status='ONLINE', last_heartbeat_at=now()
                returning id
            """),
            {"name": node_name},
        ).mappings().first()

        job = conn.execute(
            text("""
                select id from judge_jobs
                where status = 'PENDING'
                order by id asc
                for update skip locked
                limit 1
            """)
        ).mappings().first()

        if not job:
            return {"ok": True, "job": None}

        row = conn.execute(
            text("""
                update judge_jobs
                set status = 'CLAIMED',
                    attempt = attempt + 1,
                    claimed_by = :node_id,
                    claimed_at = now(),
                    started_at = now()
                where id = :job_id
                returning *
            """),
            {"node_id": node["id"], "job_id": job["id"]},
        ).mappings().first()

        conn.execute(
            text("update submissions set status = 'RUNNING' where id = :submission_id"),
            {"submission_id": row["submission_id"]},
        )

    return {"ok": True, "job": dict(row)}


@app.post("/api/dev/judge/finish")
def dev_judge_finish(payload: dict):
    job_id = payload.get("job_id")
    run_status = payload.get("status")
    runtime_ms = payload.get("runtime_ms")
    memory_peak_mb = payload.get("memory_peak_mb")
    error_message = payload.get("error_message")

    if job_id is None:
        raise HTTPException(status_code=400, detail="Missing job_id")

    with engine.begin() as conn:
        job = conn.execute(
            text("select * from judge_jobs where id = :id for update"),
            {"id": job_id},
        ).mappings().first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        submission_id = job["submission_id"]

        if run_status == "RUN_FINISHED":
            conn.execute(
                text("""
                    update judge_jobs
                    set status = 'SUCCEEDED',
                        finished_at = now()
                    where id = :id
                """),
                {"id": job_id},
            )

            conn.execute(
                text("""
                    update submissions
                    set status = 'RUN_FINISHED',
                        runtime_ms = :runtime_ms,
                        memory_peak_mb = :memory_peak_mb,
                        error_message = null
                    where id = :submission_id
                """),
                {
                    "submission_id": submission_id,
                    "runtime_ms": runtime_ms,
                    "memory_peak_mb": memory_peak_mb,
                },
            )

            try:
                evaluate_submission(conn, submission_id)
            except Exception as e:
                conn.execute(
                    text("""
                        update submissions
                        set status = 'EVALUATION_FAILED',
                            error_message = :error_message,
                            runtime_ms = coalesce(:runtime_ms, runtime_ms),
                            memory_peak_mb = coalesce(:memory_peak_mb, memory_peak_mb),
                            judged_at = now()
                        where id = :submission_id
                    """),
                    {
                        "submission_id": submission_id,
                        "error_message": str(e),
                        "runtime_ms": runtime_ms,
                        "memory_peak_mb": memory_peak_mb,
                    },
                )
                return {"ok": True, "submission_id": submission_id, "status": "EVALUATION_FAILED", "error_message": str(e)}

            return {"ok": True, "submission_id": submission_id, "status": "ACCEPTED"}

        else:
            conn.execute(
                text("""
                    update judge_jobs
                    set status = 'FAILED',
                        finished_at = now()
                    where id = :id
                """),
                {"id": job_id},
            )
            conn.execute(
                text("""
                    update submissions
                    set status = 'RUN_FAILED',
                        error_message = :error_message,
                        runtime_ms = :runtime_ms,
                        memory_peak_mb = :memory_peak_mb,
                        judged_at = now()
                    where id = :submission_id
                """),
                {
                    "submission_id": submission_id,
                    "error_message": error_message or "Run failed",
                    "runtime_ms": runtime_ms,
                    "memory_peak_mb": memory_peak_mb,
                },
            )
            return {"ok": True, "submission_id": submission_id, "status": "RUN_FAILED"}


@app.post("/api/dev/evaluate/{submission_id}")
def dev_evaluate(submission_id: int):
    with engine.begin() as conn:
        evaluate_submission(conn, submission_id)
    return {"ok": True, "submission_id": submission_id}


@app.get("/api/submissions/{submission_id}/output")
def submission_output(submission_id: int, user=Depends(get_optional_user)):
    sub = get_submission(submission_id, user)

    if not sub.get("output_object_key"):
        raise HTTPException(status_code=404, detail="Submission has no output file")

    try:
        content = get_text(S3_BUCKET_SUBMISSIONS, sub["output_object_key"])
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Output file not found: {e}")

    return {
        "submission": sub,
        "filename": "submission.csv",
        "content_type": "text/csv",
        "content": content,
    }


@app.get("/api/dev/internal-status")
def dev_status():
    with engine.connect() as conn:
        pending = conn.execute(text("select count(*) as c from judge_jobs where status = 'PENDING'")).scalar()
        running = conn.execute(text("select count(*) as c from judge_jobs where status in ('CLAIMED','RUNNING')")).scalar()
    return {"ok": True, "pending_jobs": pending, "running_jobs": running}


# ---- user management v1 ----

def get_setting_bool(key: str, default: bool = False) -> bool:
    try:
        with engine.connect() as conn:
            row = conn.execute(text("select value from system_settings where key = :key"), {"key": key}).mappings().first()
        if not row:
            return default
        return str(row["value"]).lower() in {"1", "true", "yes", "on"}
    except Exception:
        return default


def set_setting_bool(key: str, value: bool):
    with engine.begin() as conn:
        conn.execute(
            text("insert into system_settings(key, value, updated_at) values (:key, :value, now()) on conflict (key) do update set value = excluded.value, updated_at = now()"),
            {"key": key, "value": "true" if value else "false"},
        )


def init_user_admin_features():
    with engine.begin() as conn:
        conn.execute(text("create table if not exists system_settings (key text primary key, value text not null, updated_at timestamptz not null default now())"))
        conn.execute(text("alter table users add column if not exists is_disabled boolean not null default false"))
        conn.execute(text("insert into system_settings(key, value) values ('registration_enabled', 'true') on conflict (key) do nothing"))


@app.get("/api/config")
def public_config():
    return {"registration_enabled": get_setting_bool("registration_enabled", True)}


@app.get("/api/admin/settings")
def admin_settings(user=Depends(require_admin)):
    return {"registration_enabled": get_setting_bool("registration_enabled", True)}


@app.post("/api/admin/settings/registration")
def admin_set_registration(payload: dict, user=Depends(require_admin)):
    enabled = bool(payload.get("enabled"))
    set_setting_bool("registration_enabled", enabled)
    return {"ok": True, "registration_enabled": enabled}


@app.get("/api/admin/users")
def admin_users(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(text("select id, username, email, role, coalesce(is_disabled, false) as is_disabled, created_at from users order by id asc")).mappings().all()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/admin/users/{user_id}/role")
def admin_set_user_role(user_id: int, payload: dict, user=Depends(require_admin)):
    role = str(payload.get("role") or "").upper()
    if role not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == user["id"] and role != "ADMIN":
        raise HTTPException(status_code=400, detail="Cannot demote yourself")
    with engine.begin() as conn:
        row = conn.execute(text("update users set role = :role where id = :id returning id, username, email, role, coalesce(is_disabled, false) as is_disabled, created_at"), {"id": user_id, "role": role}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user": dict(row)}


@app.post("/api/admin/users/{user_id}/disabled")
def admin_set_user_disabled(user_id: int, payload: dict, user=Depends(require_admin)):
    is_disabled = bool(payload.get("is_disabled"))
    if user_id == user["id"] and is_disabled:
        raise HTTPException(status_code=400, detail="Cannot disable yourself")
    with engine.begin() as conn:
        row = conn.execute(text("update users set is_disabled = :is_disabled where id = :id returning id, username, email, role, coalesce(is_disabled, false) as is_disabled, created_at"), {"id": user_id, "is_disabled": is_disabled}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user": dict(row)}



# ---- password management v1 ----

@app.post("/api/auth/change-password")
def auth_change_password(payload: dict, user=Depends(require_user)):
    old_password = payload.get("old_password") or ""
    new_password = payload.get("new_password") or ""

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    with engine.begin() as conn:
        row = conn.execute(
            text("select id, password_hash from users where id = :id"),
            {"id": user["id"]},
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        if not verify_password(old_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        conn.execute(
            text("update users set password_hash = :password_hash where id = :id"),
            {"id": user["id"], "password_hash": hash_password(new_password)},
        )

    return {"ok": True}


@app.post("/api/admin/users/{user_id}/password")
def admin_reset_user_password(user_id: int, payload: dict, user=Depends(require_admin)):
    new_password = payload.get("new_password") or ""

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    with engine.begin() as conn:
        row = conn.execute(
            text("update users set password_hash = :password_hash where id = :id returning id, username, email, role"),
            {"id": user_id, "password_hash": hash_password(new_password)},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {"ok": True, "user": dict(row)}


# ---- contest v1 ----
from datetime import datetime, timezone


def init_contest_features():
    with engine.begin() as conn:
        conn.execute(text("""
            create table if not exists contests (
                id serial primary key,
                slug text not null unique,
                title text not null,
                description_md text not null default '',
                status text not null default 'DRAFT',
                start_at timestamptz null,
                end_at timestamptz null,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
        """))
        conn.execute(text("""
            create table if not exists contest_problems (
                contest_id integer not null references contests(id) on delete cascade,
                problem_id integer not null references problems(id) on delete cascade,
                display_order integer not null default 0,
                primary key (contest_id, problem_id)
            )
        """))
        conn.execute(text("alter table submissions add column if not exists contest_id integer null references contests(id) on delete set null"))
        conn.execute(text("create index if not exists idx_submissions_contest_id on submissions(contest_id)"))
        conn.execute(text("create index if not exists idx_contest_problems_contest_id on contest_problems(contest_id)"))


def _contest_state(row):
    now = datetime.now(timezone.utc)
    start_at = row.get("start_at")
    end_at = row.get("end_at")
    if row.get("status") != "PUBLIC":
        return "DRAFT"
    if start_at and now < start_at:
        return "UPCOMING"
    if end_at and now > end_at:
        return "ENDED"
    return "RUNNING"


def _contest_dict(row):
    d = dict(row)
    d["state"] = _contest_state(d)
    return d


def _get_contest(slug: str, public_only: bool = True):
    with engine.connect() as conn:
        if public_only:
            row = conn.execute(text("select * from contests where slug = :slug and status = 'PUBLIC'"), {"slug": slug}).mappings().first()
        else:
            row = conn.execute(text("select * from contests where slug = :slug"), {"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return _contest_dict(row)


def _contest_problem_rows(contest_id: int, public_only: bool = True):
    with engine.connect() as conn:
        status_filter = "and p.status = 'PUBLIC'" if public_only else ""
        rows = conn.execute(
            text(f"""
                select p.id, p.slug, p.title, p.metric, p.higher_is_better,
                       p.time_limit_sec, p.memory_limit_mb, p.cpu_count, cp.display_order
                from contest_problems cp
                join problems p on p.id = cp.problem_id
                where cp.contest_id = :contest_id
                {status_filter}
                order by cp.display_order asc, p.id asc
            """),
            {"contest_id": contest_id},
        ).mappings().all()
    return [dict(r) for r in rows]


@app.get("/api/contests")
def list_contests():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            select c.*, count(cp.problem_id) as problem_count
            from contests c
            left join contest_problems cp on cp.contest_id = c.id
            where c.status = 'PUBLIC'
                  and coalesce(c.visibility, 'PUBLIC') <> 'PRIVATE'
            group by c.id
            order by c.start_at nulls last, c.created_at desc
        """)).mappings().all()
    return {"items": [_contest_dict(r) for r in rows]}


@app.get("/api/contests/{slug}")
def contest_detail(slug: str):
    contest = _get_contest(slug, public_only=True)
    contest["problems"] = _contest_problem_rows(contest["id"], public_only=True)
    return contest


@app.get("/api/contests/{slug}/leaderboard")
def contest_leaderboard(slug: str):
    contest = _get_contest(slug, public_only=True)
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                with ranked as (
                    select s.id as submission_id, s.user_id,
                           coalesce(u.username, 'anonymous') as username,
                           s.problem_id, s.public_score, s.private_score,
                           row_number() over (
                               partition by coalesce(s.user_id, 0), s.problem_id
                               order by s.public_score desc nulls last, s.id asc
                           ) as rn
                    from submissions s
                    join contest_problems cp on cp.problem_id = s.problem_id and cp.contest_id = :contest_id
                    left join users u on u.id = s.user_id
                    where s.status = 'ACCEPTED'
                    and s.contest_id = :contest_id
                ), best as (select * from ranked where rn = 1)
                select user_id, username, count(*) as solved,
                       sum(public_score) as total_public_score,
                       sum(private_score) as total_private_score,
                       json_agg(json_build_object(
                           'problem_id', problem_id,
                           'submission_id', submission_id,
                           'public_score', public_score,
                           'private_score', private_score
                       ) order by problem_id) as problems
                from best
                group by user_id, username
                order by total_public_score desc nulls last, solved desc, username asc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()
    items = []
    for idx, r in enumerate(rows, start=1):
        d = dict(r)
        d["rank"] = idx
        items.append(d)
    return {"contest_slug": slug, "items": items}


@app.get("/api/admin/contests")
def admin_list_contests(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            select c.*, count(cp.problem_id) as problem_count
            from contests c
            left join contest_problems cp on cp.contest_id = c.id
            group by c.id
            order by c.created_at desc
        """)).mappings().all()
    return {"items": [_contest_dict(r) for r in rows]}



# ---- contest timezone v1 ----

def parse_contest_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

@app.post("/api/admin/contests/upsert")
def admin_upsert_contest(payload: dict, user=Depends(require_admin)):
    slug = str(payload.get("slug") or "").strip()
    title = str(payload.get("title") or "").strip()
    description_md = str(payload.get("description_md") or "")
    status = str(payload.get("status") or "DRAFT").strip().upper()
    start_at = parse_contest_datetime(payload.get("start_at") or None)
    end_at = parse_contest_datetime(payload.get("end_at") or None)
    problem_slugs = payload.get("problem_slugs") or []
    if isinstance(problem_slugs, str):
        problem_slugs = [x.strip() for x in problem_slugs.split(",") if x.strip()]
    else:
        problem_slugs = [str(x).strip() for x in problem_slugs if str(x).strip()]
    if not slug:
        raise HTTPException(status_code=400, detail="Missing slug")
    if not title:
        raise HTTPException(status_code=400, detail="Missing title")
    if status not in {"DRAFT", "PUBLIC", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    with engine.begin() as conn:
        row = conn.execute(text("""
            insert into contests(slug, title, description_md, status, start_at, end_at, updated_at)
            values (:slug, :title, :description_md, :status, :start_at, :end_at, now())
            on conflict (slug) do update set
                title = excluded.title,
                description_md = excluded.description_md,
                status = excluded.status,
                start_at = excluded.start_at,
                end_at = excluded.end_at,
                updated_at = now()
            returning *
        """), {"slug": slug, "title": title, "description_md": description_md, "status": status, "start_at": start_at, "end_at": end_at}).mappings().first()
        contest_id = row["id"]
        conn.execute(text("delete from contest_problems where contest_id = :contest_id"), {"contest_id": contest_id})
        for i, problem_slug in enumerate(problem_slugs):
            problem = conn.execute(text("select id from problems where slug = :slug"), {"slug": problem_slug}).mappings().first()
            if not problem:
                raise HTTPException(status_code=400, detail=f"Problem not found: {problem_slug}")
            conn.execute(text("""
                insert into contest_problems(contest_id, problem_id, display_order)
                values (:contest_id, :problem_id, :display_order)
                on conflict (contest_id, problem_id) do update set display_order = excluded.display_order
            """), {"contest_id": contest_id, "problem_id": problem["id"], "display_order": i})
    contest = _contest_dict(row)
    contest["problems"] = _contest_problem_rows(contest["id"], public_only=False)
    return {"ok": True, "contest": contest}


@app.post("/api/admin/contests/{slug}/status")
def admin_set_contest_status(slug: str, payload: dict, user=Depends(require_admin)):
    status = str(payload.get("status") or "").strip().upper()
    if status not in {"DRAFT", "PUBLIC", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    with engine.begin() as conn:
        row = conn.execute(text("update contests set status = :status, updated_at = now() where slug = :slug returning *"), {"slug": slug, "status": status}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return {"ok": True, "contest": _contest_dict(row)}


# ---- contest submission attribution v1 ----

def init_contest_features():
    with engine.begin() as conn:
        conn.execute(text("""
            create table if not exists contests (
                id serial primary key,
                slug text not null unique,
                title text not null,
                description_md text not null default '',
                status text not null default 'DRAFT',
                start_at timestamptz null,
                end_at timestamptz null,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
        """))
        conn.execute(text("""
            create table if not exists contest_problems (
                contest_id integer not null references contests(id) on delete cascade,
                problem_id integer not null references problems(id) on delete cascade,
                display_order integer not null default 0,
                primary key (contest_id, problem_id)
            )
        """))
        conn.execute(text("alter table submissions add column if not exists contest_id integer null references contests(id) on delete set null"))
        conn.execute(text("create index if not exists idx_submissions_contest_id on submissions(contest_id)"))
        conn.execute(text("create index if not exists idx_contest_problems_contest_id on contest_problems(contest_id)"))


# ---- contest participants v1 ----

def init_contest_participant_features():
    with engine.begin() as conn:
        conn.execute(text("""
            create table if not exists contests (
                id serial primary key,
                slug text not null unique,
                title text not null,
                description_md text not null default '',
                status text not null default 'DRAFT',
                start_at timestamptz null,
                end_at timestamptz null,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
        """))
        conn.execute(text("""
            create table if not exists contest_participants (
                contest_id integer not null references contests(id) on delete cascade,
                user_id integer not null references users(id) on delete cascade,
                joined_at timestamptz not null default now(),
                primary key (contest_id, user_id)
            )
        """))
        conn.execute(text("create index if not exists idx_contest_participants_contest_id on contest_participants(contest_id)"))
        conn.execute(text("create index if not exists idx_contest_participants_user_id on contest_participants(user_id)"))


def _contest_by_slug_any(slug: str):
    with engine.connect() as conn:
        row = conn.execute(
            text("select * from contests where slug = :slug"),
            {"slug": slug},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return dict(row)


def _contest_participant_count(contest_id: int) -> int:
    with engine.connect() as conn:
        row = conn.execute(
            text("select count(*) as n from contest_participants where contest_id = :contest_id"),
            {"contest_id": contest_id},
        ).mappings().first()
    return int(row["n"] if row else 0)


@app.get("/api/contests/{slug}/me")
def contest_me(slug: str, user=Depends(get_optional_user)):
    contest = _get_contest(slug, public_only=True)
    is_participant = False

    if user:
        with engine.connect() as conn:
            row = conn.execute(
                text("""
                    select 1
                    from contest_participants
                    where contest_id = :contest_id and user_id = :user_id
                """),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).first()
        is_participant = bool(row)

    return {
        "contest_slug": slug,
        "participant_count": _contest_participant_count(contest["id"]),
        "is_participant": is_participant,
        "user_id": user["id"] if user else None,
    }


@app.post("/api/contests/{slug}/join")
def contest_join(slug: str, user=Depends(require_user)):
    # contest_join_delegates_to_register_v6
    return contest_register(slug, {}, user)

@app.post("/api/contests/{slug}/leave")
def contest_leave(slug: str, user=Depends(require_user)):
    contest = _get_contest(slug, public_only=True)

    with engine.begin() as conn:
        conn.execute(
            text("""
                delete from contest_participants
                where contest_id = :contest_id and user_id = :user_id
            """),
            {"contest_id": contest["id"], "user_id": user["id"]},
        )

    return {
        "ok": True,
        "contest_slug": slug,
        "is_participant": False,
        "participant_count": _contest_participant_count(contest["id"]),
    }


@app.get("/api/admin/contests/{slug}/participants")
def admin_contest_participants(slug: str, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug)

    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select
                    u.id,
                    u.username,
                    u.email,
                    u.role,
                    cp.joined_at
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at asc, u.id asc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()

    return {
        "contest_slug": slug,
        "items": [dict(r) for r in rows],
    }


@app.post("/api/admin/contests/{slug}/participants")
def admin_add_contest_participant(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug)
    username_or_email = str(payload.get("username_or_email") or "").strip()

    if not username_or_email:
        raise HTTPException(status_code=400, detail="Missing username_or_email")

    with engine.begin() as conn:
        u = conn.execute(
            text("""
                select id, username, email, role
                from users
                where username = :q or email = :q
                limit 1
            """),
            {"q": username_or_email},
        ).mappings().first()

        if not u:
            raise HTTPException(status_code=404, detail="User not found")

        conn.execute(
            text("""
                insert into contest_participants(contest_id, user_id)
                values (:contest_id, :user_id)
                on conflict (contest_id, user_id) do nothing
            """),
            {"contest_id": contest["id"], "user_id": u["id"]},
        )

    return {"ok": True, "user": dict(u), "participant_count": _contest_participant_count(contest["id"])}


@app.post("/api/admin/contests/{slug}/participants/remove")
def admin_remove_contest_participant(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug)
    user_id = payload.get("user_id")

    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")

    with engine.begin() as conn:
        conn.execute(
            text("""
                delete from contest_participants
                where contest_id = :contest_id and user_id = :user_id
            """),
            {"contest_id": contest["id"], "user_id": int(user_id)},
        )

    return {"ok": True, "participant_count": _contest_participant_count(contest["id"])}


# ---- contest ops v2 ----

def init_contest_ops_features():
    with engine.begin() as conn:
        conn.execute(text("""
            create table if not exists contest_announcements (
                id serial primary key,
                contest_id integer not null references contests(id) on delete cascade,
                title text not null,
                body_md text not null default '',
                is_published boolean not null default true,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
        """))
        conn.execute(text("create index if not exists idx_contest_announcements_contest_id on contest_announcements(contest_id)"))
        conn.execute(text("""
            create table if not exists contest_participants (
                contest_id integer not null references contests(id) on delete cascade,
                user_id integer not null references users(id) on delete cascade,
                joined_at timestamptz not null default now(),
                primary key (contest_id, user_id)
            )
        """))


@app.get("/api/contests/{slug}/stats")
def contest_stats(slug: str):
    contest = _get_contest(slug, public_only=True)

    with engine.connect() as conn:
        row = conn.execute(
            text("""
                select
                    (select count(*) from contest_participants where contest_id = :contest_id) as participant_count,
                    (select count(*) from submissions where contest_id = :contest_id) as submission_count,
                    (select count(*) from submissions where contest_id = :contest_id and status = 'ACCEPTED') as accepted_count,
                    (select count(distinct user_id) from submissions where contest_id = :contest_id and user_id is not null) as submitting_user_count
            """),
            {"contest_id": contest["id"]},
        ).mappings().first()

    return {"contest_slug": slug, **dict(row)}


@app.get("/api/contests/{slug}/announcements")
def contest_announcements(slug: str):
    contest = _get_contest(slug, public_only=True)

    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select id, title, body_md, created_at, updated_at
                from contest_announcements
                where contest_id = :contest_id and is_published = true
                order by created_at desc, id desc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@app.get("/api/contests/{slug}/submissions")
def contest_user_submissions(slug: str, show_all: bool = False, limit: int = 50, user=Depends(require_user)):
    contest = _get_contest(slug, public_only=True)
    limit = max(1, min(int(limit or 50), 200))

    where_user = ""
    params = {"contest_id": contest["id"], "limit": limit}

    if not (show_all and user.get("role") == "ADMIN"):
        where_user = "and s.user_id = :user_id"
        params["user_id"] = user["id"]

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                select
                    s.id,
                    s.problem_id,
                    p.slug as problem_slug,
                    p.title as problem_title,
                    s.status,
                    s.public_score,
                    s.private_score,
                    s.runtime_ms,
                    s.error_message,
                    s.created_at,
                    s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                where s.contest_id = :contest_id
                {where_user}
                order by s.id desc
                limit :limit
            """),
            params,
        ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@app.post("/api/admin/contests/{slug}/announcements")
def admin_create_contest_announcement(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)
    title = str(payload.get("title") or "").strip()
    body_md = str(payload.get("body_md") or "")
    is_published = bool(payload.get("is_published", True))

    if not title:
        raise HTTPException(status_code=400, detail="Missing title")

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                insert into contest_announcements(contest_id, title, body_md, is_published)
                values (:contest_id, :title, :body_md, :is_published)
                returning id, title, body_md, is_published, created_at, updated_at
            """),
            {
                "contest_id": contest["id"],
                "title": title,
                "body_md": body_md,
                "is_published": is_published,
            },
        ).mappings().first()

    return {"ok": True, "announcement": dict(row)}


@app.post("/api/admin/contests/{slug}/announcements/{announcement_id}/delete")
def admin_delete_contest_announcement(slug: str, announcement_id: int, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)

    with engine.begin() as conn:
        conn.execute(
            text("""
                delete from contest_announcements
                where id = :id and contest_id = :contest_id
            """),
            {"id": announcement_id, "contest_id": contest["id"]},
        )

    return {"ok": True}


@app.get("/api/admin/contests/{slug}/participants.csv")
def admin_export_contest_participants_csv(slug: str, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)

    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select u.id, u.username, coalesce(u.email, '') as email, u.role, cp.joined_at
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at asc, u.id asc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()

    def esc(v):
        text_value = "" if v is None else str(v)
        return '"' + text_value.replace('"', '""') + '"'

    lines = ["id,username,email,role,joined_at"]
    for r in rows:
        lines.append(",".join([esc(r["id"]), esc(r["username"]), esc(r["email"]), esc(r["role"]), esc(r["joined_at"])]))

    csv = "\n".join(lines) + "\n"
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_participants.csv"'},
    )


# ---- contest scoreboard v3 ----

def init_contest_scoreboard_features():
    with engine.begin() as conn:
        conn.execute(text("alter table contests add column if not exists freeze_at timestamptz null"))
        conn.execute(text("alter table contests add column if not exists show_private_after_end boolean not null default false"))
        conn.execute(text("""
            create table if not exists contest_participants (
                contest_id integer not null references contests(id) on delete cascade,
                user_id integer not null references users(id) on delete cascade,
                joined_at timestamptz not null default now(),
                primary key (contest_id, user_id)
            )
        """))
        conn.execute(text("create index if not exists idx_submissions_contest_scoreboard on submissions(contest_id, status, user_id, problem_id)"))


def parse_scoreboard_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _scoreboard_rows(contest_id: int, visible_until=None, show_private: bool = False):
    where_extra = ""
    params = {"contest_id": contest_id, "show_private": show_private}
    if visible_until is not None:
        where_extra = "and coalesce(s.judged_at, s.created_at) <= :visible_until"
        params["visible_until"] = visible_until

    score_expr = "case when :show_private then coalesce(s.private_score, s.public_score) else s.public_score end"

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                with ranked as (
                    select
                        s.id as submission_id,
                        s.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        s.problem_id,
                        p.slug as problem_slug,
                        p.title as problem_title,
                        s.public_score,
                        s.private_score,
                        {score_expr} as visible_score,
                        p.higher_is_better,
                        coalesce(s.judged_at, s.created_at) as score_time,
                        row_number() over (
                            partition by s.user_id, s.problem_id
                            order by
                                case
                                    when p.higher_is_better then coalesce(({score_expr}), '-Infinity'::float8)
                                    else -coalesce(({score_expr}), 'Infinity'::float8)
                                end desc,
                                s.id asc
                        ) as rn
                    from submissions s
                    join contest_participants cpart
                      on cpart.contest_id = :contest_id and cpart.user_id = s.user_id
                    join problems p on p.id = s.problem_id
                    left join users u on u.id = s.user_id
                    where s.status = 'ACCEPTED'
                      and s.contest_id = :contest_id
                      {where_extra}
                ),
                best as (
                    select * from ranked where rn = 1
                )
                select
                    user_id,
                    username,
                    count(*) as solved,
                    sum(visible_score) as total_score,
                    sum(public_score) as total_public_score,
                    sum(private_score) as total_private_score,
                    max(score_time) as last_score_time,
                    json_agg(json_build_object(
                        'problem_id', problem_id,
                        'problem_slug', problem_slug,
                        'submission_id', submission_id,
                        'public_score', public_score,
                        'private_score', private_score,
                        'visible_score', visible_score
                    ) order by problem_slug) as problems
                from best
                group by user_id, username
                order by total_score desc nulls last, solved desc, last_score_time asc nulls last, username asc
            """),
            params,
        ).mappings().all()

    items = []
    for i, row in enumerate(rows, start=1):
        d = dict(row)
        d["rank"] = i
        items.append(d)
    return items


@app.get("/api/contests/{slug}/scoreboard")
def contest_scoreboard(slug: str, admin_full: bool = False, user=Depends(get_optional_user)):
    contest = _get_contest(slug, public_only=True)
    state = _contest_state(contest)
    now = datetime.now(timezone.utc)

    freeze_at = contest.get("freeze_at")
    is_admin = bool(user and user.get("role") == "ADMIN")
    use_admin_full = bool(admin_full and is_admin)

    show_private = bool(contest.get("show_private_after_end")) and state == "ENDED"
    is_frozen = bool(freeze_at and now >= freeze_at and state != "ENDED" and not use_admin_full)
    visible_until = freeze_at if is_frozen else None

    items = _scoreboard_rows(contest["id"], visible_until=visible_until, show_private=show_private)

    return {
        "contest_slug": slug,
        "state": state,
        "items": items,
        "is_frozen": is_frozen,
        "freeze_at": freeze_at,
        "visible_until": visible_until,
        "show_private": show_private,
        "admin_full": use_admin_full,
    }


@app.post("/api/admin/contests/{slug}/scoreboard-settings")
def admin_contest_scoreboard_settings(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)
    freeze_at = parse_scoreboard_datetime(payload.get("freeze_at"))
    show_private_after_end = bool(payload.get("show_private_after_end", False))

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update contests
                set freeze_at = :freeze_at,
                    show_private_after_end = :show_private_after_end,
                    updated_at = now()
                where id = :contest_id
                returning id, slug, freeze_at, show_private_after_end
            """),
            {
                "contest_id": contest["id"],
                "freeze_at": freeze_at,
                "show_private_after_end": show_private_after_end,
            },
        ).mappings().first()

    return {"ok": True, "contest": dict(row)}


@app.get("/api/admin/contests/{slug}/scoreboard.csv")
def admin_export_contest_scoreboard_csv(slug: str, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)
    items = _scoreboard_rows(contest["id"], visible_until=None, show_private=True)

    def esc(v):
        text_value = "" if v is None else str(v)
        return '"' + text_value.replace('"', '""') + '"'

    lines = ["rank,user_id,username,solved,total_score,total_public_score,total_private_score,last_score_time"]
    for r in items:
        lines.append(",".join([
            esc(r.get("rank")),
            esc(r.get("user_id")),
            esc(r.get("username")),
            esc(r.get("solved")),
            esc(r.get("total_score")),
            esc(r.get("total_public_score")),
            esc(r.get("total_private_score")),
            esc(r.get("last_score_time")),
        ]))

    csv = "\n".join(lines) + "\n"
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_scoreboard.csv"'},
    )


# ---- contest clarification v4 ----

def init_contest_clarification_features():
    with engine.begin() as conn:
        conn.execute(text("""
            create table if not exists contest_questions (
                id serial primary key,
                contest_id integer not null references contests(id) on delete cascade,
                user_id integer null references users(id) on delete set null,
                title text not null,
                body_md text not null default '',
                answer_md text null,
                status text not null default 'OPEN',
                is_public boolean not null default false,
                created_at timestamptz not null default now(),
                answered_at timestamptz null
            )
        """))
        conn.execute(text("create index if not exists idx_contest_questions_contest_id on contest_questions(contest_id)"))
        conn.execute(text("create index if not exists idx_contest_questions_user_id on contest_questions(user_id)"))


@app.get("/api/contests/{slug}/questions")
def contest_questions(slug: str, user=Depends(get_optional_user)):
    contest = _get_contest(slug, public_only=True)
    is_admin = bool(user and user.get("role") == "ADMIN")

    with engine.connect() as conn:
        if is_admin:
            rows = conn.execute(
                text("""
                    select
                        q.id,
                        q.title,
                        q.body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        true as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                    order by q.created_at desc, q.id desc
                """),
                {"contest_id": contest["id"]},
            ).mappings().all()
        elif user:
            rows = conn.execute(
                text("""
                    select
                        q.id,
                        q.title,
                        case when q.is_public or q.user_id = :user_id then q.body_md else '' end as body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        case when q.is_public or q.user_id = :user_id then true else false end as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                      and (q.is_public = true or q.user_id = :user_id)
                    order by q.created_at desc, q.id desc
                """),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).mappings().all()
        else:
            rows = conn.execute(
                text("""
                    select
                        q.id,
                        q.title,
                        q.body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        true as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                      and q.is_public = true
                    order by q.created_at desc, q.id desc
                """),
                {"contest_id": contest["id"]},
            ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@app.post("/api/contests/{slug}/questions")
def contest_ask_question(slug: str, payload: dict, user=Depends(require_user)):
    contest = _get_contest(slug, public_only=True)
    title = str(payload.get("title") or "").strip()
    body_md = str(payload.get("body_md") or "").strip()

    if not title:
        raise HTTPException(status_code=400, detail="Missing title")
    if not body_md:
        raise HTTPException(status_code=400, detail="Missing body")

    with engine.connect() as conn:
        participant = conn.execute(
            text("select 1 from contest_participants where contest_id = :contest_id and user_id = :user_id and coalesce(status, 'ACCEPTED') = 'ACCEPTED'"),
            {"contest_id": contest["id"], "user_id": user["id"]},
        ).first()

    if not participant and user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Join contest before asking questions")

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                insert into contest_questions(contest_id, user_id, title, body_md)
                values (:contest_id, :user_id, :title, :body_md)
                returning id, title, body_md, status, is_public, created_at
            """),
            {
                "contest_id": contest["id"],
                "user_id": user["id"],
                "title": title,
                "body_md": body_md,
            },
        ).mappings().first()

    return {"ok": True, "question": dict(row)}


@app.post("/api/admin/contests/{slug}/questions/{question_id}/answer")
def admin_answer_contest_question(slug: str, question_id: int, payload: dict, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)
    answer_md = str(payload.get("answer_md") or "").strip()
    is_public = bool(payload.get("is_public", True))

    if not answer_md:
        raise HTTPException(status_code=400, detail="Missing answer")

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update contest_questions
                set answer_md = :answer_md,
                    is_public = :is_public,
                    status = 'ANSWERED',
                    answered_at = now()
                where id = :id and contest_id = :contest_id
                returning id, title, body_md, answer_md, status, is_public, created_at, answered_at
            """),
            {
                "id": question_id,
                "contest_id": contest["id"],
                "answer_md": answer_md,
                "is_public": is_public,
            },
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"ok": True, "question": dict(row)}


@app.post("/api/admin/contests/{slug}/questions/{question_id}/close")
def admin_close_contest_question(slug: str, question_id: int, user=Depends(require_admin)):
    contest = _contest_by_slug_any(slug) if "_contest_by_slug_any" in globals() else _get_contest(slug, public_only=False)

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update contest_questions
                set status = 'CLOSED'
                where id = :id and contest_id = :contest_id
                returning id, title, status
            """),
            {"id": question_id, "contest_id": contest["id"]},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"ok": True, "question": dict(row)}


# ---- contest full v6 ----

def init_contest_full_v6_features():
    with engine.begin() as conn:
        conn.execute(text("alter table contests add column if not exists visibility text not null default 'PUBLIC'"))
        conn.execute(text("alter table contests add column if not exists registration_mode text not null default 'OPEN'"))
        conn.execute(text("alter table contests add column if not exists invite_code text null"))
        conn.execute(text("alter table contests add column if not exists hide_problems_before_start boolean not null default false"))
        conn.execute(text("alter table contests add column if not exists allow_join_after_start boolean not null default true"))
        conn.execute(text("alter table contests add column if not exists scoreboard_mode text not null default 'SCORE'"))
        conn.execute(text("alter table contests add column if not exists penalty_minutes integer not null default 20"))
        conn.execute(text("alter table contests add column if not exists scoreboard_visible boolean not null default true"))
        conn.execute(text("alter table contests add column if not exists questions_enabled boolean not null default true"))
        conn.execute(text("alter table contests add column if not exists announcements_enabled boolean not null default true"))
        conn.execute(text("alter table contests add column if not exists freeze_at timestamptz null"))
        conn.execute(text("alter table contests add column if not exists show_private_after_end boolean not null default false"))
        conn.execute(text("""
            create table if not exists contest_participants (
                contest_id integer not null references contests(id) on delete cascade,
                user_id integer not null references users(id) on delete cascade,
                joined_at timestamptz not null default now(),
                primary key (contest_id, user_id)
            )
        """))
        conn.execute(text("alter table contest_participants add column if not exists status text not null default 'ACCEPTED'"))
        conn.execute(text("alter table contest_participants add column if not exists invite_code_used text null"))
        conn.execute(text("alter table contest_participants add column if not exists note text null"))
        conn.execute(text("alter table contest_participants add column if not exists approved_at timestamptz null"))
        conn.execute(text("alter table contest_participants add column if not exists rejected_at timestamptz null"))
        conn.execute(text("update contest_participants set status = 'ACCEPTED' where status is null or status = ''"))
        conn.execute(text("create index if not exists idx_contest_participants_status on contest_participants(contest_id, status)"))
        conn.execute(text("create index if not exists idx_submissions_contest_full_v6 on submissions(contest_id, user_id, problem_id, status, created_at)"))


def _contest_any(slug: str):
    with engine.connect() as conn:
        row = conn.execute(text("select * from contests where slug = :slug"), {"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return dict(row)


def _participant_row(contest_id: int, user_id: int | None):
    if not user_id:
        return None
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                select cp.*, u.username, u.email, u.role
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id and cp.user_id = :user_id
            """),
            {"contest_id": contest_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def _contest_access_payload(contest: dict, user=None):
    state = _contest_state(contest)
    is_admin = bool(user and user.get("role") == "ADMIN")
    participant = _participant_row(contest["id"], user.get("id") if user else None)
    participant_status = participant.get("status") if participant else None
    is_accepted = participant_status == "ACCEPTED"
    is_pending = participant_status == "PENDING"
    registration_mode = contest.get("registration_mode") or "OPEN"
    visibility = contest.get("visibility") or "PUBLIC"

    can_view_contest = contest.get("status") == "PUBLIC" or is_admin or is_accepted
    can_view_problems = is_admin or is_accepted
    if visibility == "PUBLIC" and not contest.get("hide_problems_before_start"):
        can_view_problems = True
    if state == "UPCOMING" and contest.get("hide_problems_before_start") and not is_admin and not is_accepted:
        can_view_problems = False

    can_submit = is_admin or (is_accepted and state == "RUNNING")
    can_ask = is_admin or (is_accepted and bool(contest.get("questions_enabled", True)))
    can_register = bool(user) and registration_mode not in ("CLOSED",) and not is_accepted and not is_pending
    if state == "RUNNING" and not contest.get("allow_join_after_start", True):
        can_register = False
    if state == "ENDED":
        can_register = False

    return {
        "visibility": visibility,
        "registration_mode": registration_mode,
        "participant_status": participant_status,
        "is_participant": is_accepted,
        "is_pending": is_pending,
        "can_view_contest": can_view_contest,
        "can_view_problems": can_view_problems,
        "can_submit": can_submit,
        "can_ask": can_ask,
        "can_register": can_register,
        "hide_problems_before_start": bool(contest.get("hide_problems_before_start", False)),
        "allow_join_after_start": bool(contest.get("allow_join_after_start", True)),
        "scoreboard_mode": contest.get("scoreboard_mode") or "SCORE",
        "penalty_minutes": contest.get("penalty_minutes") or 20,
        "scoreboard_visible": bool(contest.get("scoreboard_visible", True)),
        "questions_enabled": bool(contest.get("questions_enabled", True)),
        "announcements_enabled": bool(contest.get("announcements_enabled", True)),
        "freeze_at": contest.get("freeze_at"),
        "show_private_after_end": bool(contest.get("show_private_after_end", False)),
    }


def _parse_v6_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@app.get("/api/contests/{slug}/access")
def contest_access(slug: str, user=Depends(get_optional_user)):
    contest = _get_contest(slug, public_only=True)
    with engine.connect() as conn:
        counts = conn.execute(
            text("""
                select
                    count(*) filter (where status = 'ACCEPTED') as accepted_count,
                    count(*) filter (where status = 'PENDING') as pending_count,
                    count(*) filter (where status = 'REJECTED') as rejected_count
                from contest_participants
                where contest_id = :contest_id
            """),
            {"contest_id": contest["id"]},
        ).mappings().first()

    return {"contest_slug": slug, "state": _contest_state(contest), **_contest_access_payload(contest, user), "participant_counts": dict(counts)}


@app.post("/api/contests/{slug}/register")
def contest_register(slug: str, payload: dict | None = None, user=Depends(require_user)):
    payload = payload or {}
    contest = _get_contest(slug, public_only=True)
    state = _contest_state(contest)
    mode = contest.get("registration_mode") or "OPEN"
    invite_code = str(payload.get("invite_code") or "").strip()

    if state == "ENDED":
        raise HTTPException(status_code=403, detail="Contest has ended")
    if state == "RUNNING" and not contest.get("allow_join_after_start", True):
        raise HTTPException(status_code=403, detail="Registration is closed after contest starts")
    if mode == "CLOSED":
        raise HTTPException(status_code=403, detail="Registration is closed")
    if mode == "INVITE":
        expected = str(contest.get("invite_code") or "").strip()
        if not expected or invite_code != expected:
            raise HTTPException(status_code=403, detail="Invalid invite code")

    new_status = "PENDING" if mode == "APPROVAL" else "ACCEPTED"
    approved_at = datetime.now(timezone.utc) if new_status == "ACCEPTED" else None

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                insert into contest_participants(contest_id, user_id, status, invite_code_used, approved_at, rejected_at)
                values (:contest_id, :user_id, :status, :invite_code_used, :approved_at, null)
                on conflict (contest_id, user_id)
                do update set
                    status = case
                        when contest_participants.status = 'REJECTED' then excluded.status
                        else contest_participants.status
                    end,
                    invite_code_used = coalesce(excluded.invite_code_used, contest_participants.invite_code_used),
                    approved_at = case when excluded.status = 'ACCEPTED' then now() else contest_participants.approved_at end,
                    rejected_at = null
                returning status
            """),
            {"contest_id": contest["id"], "user_id": user["id"], "status": new_status, "invite_code_used": invite_code or None, "approved_at": approved_at},
        ).mappings().first()

    return {"ok": True, "contest_slug": slug, "participant_status": row["status"], "is_participant": row["status"] == "ACCEPTED", "is_pending": row["status"] == "PENDING"}


@app.get("/api/admin/contests/{slug}/full-settings")
def admin_get_contest_full_settings(slug: str, user=Depends(require_admin)):
    contest = _contest_any(slug)
    return {"contest": contest, "access": _contest_access_payload(contest, user)}


@app.post("/api/admin/contests/{slug}/full-settings")
def admin_update_contest_full_settings(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_any(slug)
    visibility = str(payload.get("visibility", contest.get("visibility") or "PUBLIC")).upper()
    registration_mode = str(payload.get("registration_mode", contest.get("registration_mode") or "OPEN")).upper()
    scoreboard_mode = str(payload.get("scoreboard_mode", contest.get("scoreboard_mode") or "SCORE")).upper()

    if visibility not in {"PUBLIC", "PRIVATE", "UNLISTED"}:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    if registration_mode not in {"OPEN", "INVITE", "APPROVAL", "CLOSED"}:
        raise HTTPException(status_code=400, detail="Invalid registration_mode")
    if scoreboard_mode not in {"SCORE", "ACM"}:
        raise HTTPException(status_code=400, detail="Invalid scoreboard_mode")

    freeze_at = _parse_v6_datetime(payload.get("freeze_at")) if "freeze_at" in payload else contest.get("freeze_at")
    invite_code = payload.get("invite_code", contest.get("invite_code"))

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update contests
                set visibility = :visibility,
                    registration_mode = :registration_mode,
                    invite_code = :invite_code,
                    hide_problems_before_start = :hide_problems_before_start,
                    allow_join_after_start = :allow_join_after_start,
                    scoreboard_mode = :scoreboard_mode,
                    penalty_minutes = :penalty_minutes,
                    scoreboard_visible = :scoreboard_visible,
                    questions_enabled = :questions_enabled,
                    announcements_enabled = :announcements_enabled,
                    freeze_at = :freeze_at,
                    show_private_after_end = :show_private_after_end,
                    updated_at = now()
                where id = :contest_id
                returning *
            """),
            {
                "contest_id": contest["id"],
                "visibility": visibility,
                "registration_mode": registration_mode,
                "invite_code": str(invite_code).strip() if invite_code else None,
                "hide_problems_before_start": bool(payload.get("hide_problems_before_start", contest.get("hide_problems_before_start", False))),
                "allow_join_after_start": bool(payload.get("allow_join_after_start", contest.get("allow_join_after_start", True))),
                "scoreboard_mode": scoreboard_mode,
                "penalty_minutes": int(payload.get("penalty_minutes", contest.get("penalty_minutes") or 20)),
                "scoreboard_visible": bool(payload.get("scoreboard_visible", contest.get("scoreboard_visible", True))),
                "questions_enabled": bool(payload.get("questions_enabled", contest.get("questions_enabled", True))),
                "announcements_enabled": bool(payload.get("announcements_enabled", contest.get("announcements_enabled", True))),
                "freeze_at": freeze_at,
                "show_private_after_end": bool(payload.get("show_private_after_end", contest.get("show_private_after_end", False))),
            },
        ).mappings().first()
    return {"ok": True, "contest": dict(row)}


@app.get("/api/admin/contests/{slug}/registrations")
def admin_contest_registrations(slug: str, status: str | None = None, user=Depends(require_admin)):
    contest = _contest_any(slug)
    params = {"contest_id": contest["id"]}
    where = ""
    if status:
        where = "and cp.status = :status"
        params["status"] = status.upper()

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                select cp.contest_id, cp.user_id, cp.status, cp.invite_code_used, cp.note,
                       cp.joined_at, cp.approved_at, cp.rejected_at, u.username, u.email, u.role
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                {where}
                order by cp.joined_at desc, cp.user_id asc
            """),
            params,
        ).mappings().all()
    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@app.post("/api/admin/contests/{slug}/registrations/{user_id}/status")
def admin_set_contest_registration_status(slug: str, user_id: int, payload: dict, user=Depends(require_admin)):
    contest = _contest_any(slug)
    status = str(payload.get("status") or "").upper()
    note = payload.get("note")
    if status not in {"PENDING", "ACCEPTED", "REJECTED"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                update contest_participants
                set status = :status,
                    note = :note,
                    approved_at = case when :status = 'ACCEPTED' then now() else approved_at end,
                    rejected_at = case when :status = 'REJECTED' then now() else rejected_at end
                where contest_id = :contest_id and user_id = :user_id
                returning *
            """),
            {"contest_id": contest["id"], "user_id": user_id, "status": status, "note": note},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Registration not found")
    return {"ok": True, "registration": dict(row)}


@app.post("/api/admin/contests/{slug}/registrations/bulk-add")
def admin_bulk_add_contest_registrations(slug: str, payload: dict, user=Depends(require_admin)):
    contest = _contest_any(slug)
    raw = str(payload.get("users") or "")
    status = str(payload.get("status") or "ACCEPTED").upper()
    if status not in {"PENDING", "ACCEPTED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    names = [x.strip() for x in raw.replace(",", "\n").splitlines() if x.strip()]
    added = []
    missing = []
    with engine.begin() as conn:
        for q in names:
            u = conn.execute(text("select id, username, email from users where username = :q or email = :q limit 1"), {"q": q}).mappings().first()
            if not u:
                missing.append(q)
                continue
            conn.execute(
                text("""
                    insert into contest_participants(contest_id, user_id, status, approved_at)
                    values (:contest_id, :user_id, :status, case when :status = 'ACCEPTED' then now() else null end)
                    on conflict (contest_id, user_id)
                    do update set status = excluded.status,
                                  approved_at = case when excluded.status = 'ACCEPTED' then now() else contest_participants.approved_at end,
                                  rejected_at = null
                """),
                {"contest_id": contest["id"], "user_id": u["id"], "status": status},
            )
            added.append(dict(u))
    return {"ok": True, "added": added, "missing": missing}


@app.get("/api/admin/contests/{slug}/registrations.csv")
def admin_export_contest_registrations_csv(slug: str, user=Depends(require_admin)):
    contest = _contest_any(slug)
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select u.id, u.username, coalesce(u.email, '') as email, u.role,
                       cp.status, coalesce(cp.invite_code_used, '') as invite_code_used,
                       cp.joined_at, cp.approved_at, cp.rejected_at, coalesce(cp.note, '') as note
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at desc, u.id asc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()
    def esc(v):
        t = "" if v is None else str(v)
        return '"' + t.replace('"', '""') + '"'
    keys = ["id","username","email","role","status","invite_code_used","joined_at","approved_at","rejected_at","note"]
    lines = [",".join(keys)]
    for r in rows:
        lines.append(",".join([esc(r[k]) for k in keys]))
    return Response(content="\n".join(lines) + "\n", media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{slug}_registrations.csv"'})


def _contest_score_rows_advanced(contest: dict, visible_until=None, show_private=False):
    contest_id = contest["id"]
    mode = (contest.get("scoreboard_mode") or "SCORE").upper()
    params = {"contest_id": contest_id}
    where_time = ""
    if visible_until is not None:
        where_time = "and coalesce(s.judged_at, s.created_at) <= :visible_until"
        params["visible_until"] = visible_until

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                select s.id, s.user_id, u.username, s.problem_id, p.slug as problem_slug, p.title as problem_title,
                       p.higher_is_better, s.status, s.public_score, s.private_score, s.created_at, s.judged_at
                from submissions s
                join contest_participants cp on cp.contest_id = :contest_id and cp.user_id = s.user_id and cp.status = 'ACCEPTED'
                join users u on u.id = s.user_id
                join problems p on p.id = s.problem_id
                where s.contest_id = :contest_id
                {where_time}
                order by s.user_id asc, s.problem_id asc, s.id asc
            """),
            params,
        ).mappings().all()

    by_user = {}
    if mode == "ACM":
        start_at = contest.get("start_at") or datetime.now(timezone.utc)
        penalty_minutes = int(contest.get("penalty_minutes") or 20)
        per = {}
        for r in rows:
            per.setdefault((r["user_id"], r["problem_id"]), []).append(dict(r))
        for (user_id, problem_id), subs in per.items():
            username = subs[0]["username"]
            problem_slug = subs[0]["problem_slug"]
            failed = 0
            accepted = None
            for sub in subs:
                if sub["status"] == "ACCEPTED":
                    accepted = sub
                    break
                failed += 1
            u = by_user.setdefault(user_id, {"user_id": user_id, "username": username, "solved": 0, "penalty": 0, "problems": []})
            if accepted:
                ac_time = accepted.get("judged_at") or accepted.get("created_at")
                minutes = int(max(0, (ac_time - start_at).total_seconds()) // 60)
                penalty = minutes + failed * penalty_minutes
                u["solved"] += 1
                u["penalty"] += penalty
                u["problems"].append({"problem_id": problem_id, "problem_slug": problem_slug, "submission_id": accepted["id"], "attempts": failed + 1, "penalty": penalty, "status": "AC"})
            else:
                u["problems"].append({"problem_id": problem_id, "problem_slug": problem_slug, "attempts": failed, "status": "TRIED"})
        items = sorted(by_user.values(), key=lambda x: (-x["solved"], x["penalty"], x["username"]))
        for i, item in enumerate(items, start=1):
            item["rank"] = i
            item["total_score"] = item["solved"]
            item["total_public_score"] = item["solved"]
            item["total_private_score"] = item["solved"]
        return items

    best = {}
    for r in rows:
        if r["status"] != "ACCEPTED":
            continue
        score = r["private_score"] if show_private and r["private_score"] is not None else r["public_score"]
        if score is None:
            continue
        key = (r["user_id"], r["problem_id"])
        old = best.get(key)
        better = old is None or (score > old["visible_score"] if r["higher_is_better"] else score < old["visible_score"])
        if better:
            d = dict(r)
            d["visible_score"] = score
            best[key] = d

    for r in best.values():
        u = by_user.setdefault(r["user_id"], {"user_id": r["user_id"], "username": r["username"], "solved": 0, "total_score": 0, "total_public_score": 0, "total_private_score": 0, "problems": []})
        u["solved"] += 1
        u["total_score"] += r["visible_score"] or 0
        u["total_public_score"] += r["public_score"] or 0
        u["total_private_score"] += r["private_score"] or 0
        u["problems"].append({"problem_id": r["problem_id"], "problem_slug": r["problem_slug"], "submission_id": r["id"], "public_score": r["public_score"], "private_score": r["private_score"], "visible_score": r["visible_score"]})
    items = sorted(by_user.values(), key=lambda x: (-(x["total_score"] or 0), -x["solved"], x["username"]))
    for i, item in enumerate(items, start=1):
        item["rank"] = i
    return items


@app.get("/api/contests/{slug}/scoreboard-advanced")
def contest_scoreboard_advanced(slug: str, admin_full: bool = False, user=Depends(get_optional_user)):
    contest = _get_contest(slug, public_only=True)
    access = _contest_access_payload(contest, user)
    is_admin = bool(user and user.get("role") == "ADMIN")
    if not access["scoreboard_visible"] and not is_admin:
        raise HTTPException(status_code=403, detail="Scoreboard is hidden")
    state = _contest_state(contest)
    now = datetime.now(timezone.utc)
    freeze_at = contest.get("freeze_at")
    show_private = bool(contest.get("show_private_after_end")) and state == "ENDED"
    is_frozen = bool(freeze_at and now >= freeze_at and state != "ENDED" and not (admin_full and is_admin))
    visible_until = freeze_at if is_frozen else None
    return {"contest_slug": slug, "state": state, "mode": (contest.get("scoreboard_mode") or "SCORE").upper(), "items": _contest_score_rows_advanced(contest, visible_until=visible_until, show_private=show_private), "is_frozen": is_frozen, "freeze_at": freeze_at, "visible_until": visible_until, "show_private": show_private, "admin_full": bool(admin_full and is_admin)}


@app.get("/api/contests/{slug}/problem-stats")
def contest_problem_stats(slug: str):
    contest = _get_contest(slug, public_only=True)
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                select p.id, p.slug, p.title,
                       count(distinct s.user_id) filter (where s.status = 'ACCEPTED') as solved_users,
                       count(s.id) as submissions,
                       min(s.judged_at) filter (where s.status = 'ACCEPTED') as first_ac_at
                from contest_problems cp
                join problems p on p.id = cp.problem_id
                left join submissions s on s.problem_id = p.id and s.contest_id = cp.contest_id
                left join contest_participants cpart on cpart.contest_id = cp.contest_id and cpart.user_id = s.user_id and cpart.status = 'ACCEPTED'
                where cp.contest_id = :contest_id
                group by p.id, p.slug, p.title, cp.display_order
                order by cp.display_order asc, p.id asc
            """),
            {"contest_id": contest["id"]},
        ).mappings().all()
    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@app.get("/api/admin/contests/{slug}/scoreboard-advanced.csv")
def admin_export_advanced_scoreboard_csv(slug: str, user=Depends(require_admin)):
    contest = _contest_any(slug)
    items = _contest_score_rows_advanced(contest, visible_until=None, show_private=True)
    def esc(v):
        t = "" if v is None else str(v)
        return '"' + t.replace('"', '""') + '"'
    mode = (contest.get("scoreboard_mode") or "SCORE").upper()
    if mode == "ACM":
        keys = ["rank","user_id","username","solved","penalty"]
    else:
        keys = ["rank","user_id","username","solved","total_score","total_public_score","total_private_score"]
    lines = [",".join(keys)]
    for r in items:
        lines.append(",".join([esc(r.get(k)) for k in keys]))
    return Response(content="\n".join(lines) + "\n", media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{slug}_advanced_scoreboard.csv"'})

