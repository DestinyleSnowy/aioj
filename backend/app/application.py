from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.bootstrap import ensure_admin, validate_runtime_configuration
from app.migrations import ensure_drive_schema_compatibility, ensure_message_schema_compatibility, run_migrations
from app.routers.admin_analytics import router as admin_analytics_router
from app.routers.admin_users import router as admin_users_router
from app.routers.audit_admin import router as audit_admin_router
from app.routers.auth import router as auth_router
from app.routers.contest_admin import router as contest_admin_router
from app.routers.contests import router as contests_router
from app.routers.drive import router as drive_router
from app.routers.internal import router as internal_router
from app.routers.judge_admin import router as judge_admin_router
from app.routers.messages import router as messages_router
from app.routers.notifications import router as notifications_router
from app.routers.problems import router as problems_router
from app.routers.submissions import router as submissions_router
from app.routers.system import router as system_router
from app.services.system_settings import ensure_default_settings
from app.settings import settings
from app.storage import (
    S3_BUCKET_AVATARS,
    S3_BUCKET_DRIVE,
    S3_BUCKET_LOGS,
    S3_BUCKET_MESSAGES,
    S3_BUCKET_PROBLEMS,
    S3_BUCKET_SUBMISSIONS,
    ensure_bucket,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_runtime_configuration()
    if settings.run_migrations_on_startup:
        run_migrations()
    # Keep chat online even if a deployment skipped the latest Alembic revision.
    ensure_message_schema_compatibility()
    # Keep drive online for deployments that start before the newest revision lands.
    ensure_drive_schema_compatibility()
    ensure_default_settings()
    ensure_bucket(S3_BUCKET_PROBLEMS)
    ensure_bucket(S3_BUCKET_SUBMISSIONS)
    ensure_bucket(S3_BUCKET_LOGS)
    ensure_bucket(S3_BUCKET_MESSAGES)
    ensure_bucket(S3_BUCKET_AVATARS)
    ensure_bucket(S3_BUCKET_DRIVE)
    if settings.bootstrap_admin_on_startup:
        ensure_admin()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="AIOJ API", version="scorer-v1", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials="*" not in settings.cors_allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for router in (
        system_router,
        auth_router,
        admin_analytics_router,
        admin_users_router,
        audit_admin_router,
        judge_admin_router,
        notifications_router,
        drive_router,
        messages_router,
        problems_router,
        submissions_router,
        internal_router,
        contests_router,
        contest_admin_router,
    ):
        app.include_router(router)

    return app
