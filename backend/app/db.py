from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.settings import settings


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def check_db() -> bool:
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    return True
