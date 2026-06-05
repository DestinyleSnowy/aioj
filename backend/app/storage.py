import time

import boto3
from botocore.exceptions import ClientError

from app.settings import settings

S3_BUCKET_PROBLEMS = settings.s3_bucket_problems
S3_BUCKET_SUBMISSIONS = settings.s3_bucket_submissions
S3_BUCKET_LOGS = settings.s3_bucket_logs
S3_BUCKET_MESSAGES = settings.s3_bucket_messages
S3_BUCKET_AVATARS = settings.s3_bucket_avatars


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )


def ensure_bucket(name: str):
    last_error = None
    for attempt in range(5):
        s3 = s3_client()
        try:
            s3.head_bucket(Bucket=name)
            return
        except ClientError:
            try:
                s3.create_bucket(Bucket=name)
                return
            except Exception as exc:
                last_error = exc
        time.sleep(min(5, attempt + 1))
    if last_error is not None:
        raise last_error


def put_text(bucket: str, key: str, body: str, content_type: str = "text/plain; charset=utf-8"):
    s3_client().put_object(Bucket=bucket, Key=key, Body=body.encode("utf-8"), ContentType=content_type)


def get_text(bucket: str, key: str) -> str:
    obj = s3_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read().decode("utf-8", errors="replace")


def put_bytes(bucket: str, key: str, body: bytes, content_type: str = "application/octet-stream"):
    s3_client().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)


def head_object(bucket: str, key: str) -> dict:
    return s3_client().head_object(Bucket=bucket, Key=key)


def get_object(bucket: str, key: str, byte_range: str | None = None) -> dict:
    kwargs = {"Bucket": bucket, "Key": key}
    if byte_range:
        kwargs["Range"] = byte_range
    return s3_client().get_object(**kwargs)


def get_bytes(bucket: str, key: str) -> bytes:
    obj = s3_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def delete_object(bucket: str, key: str) -> None:
    s3_client().delete_object(Bucket=bucket, Key=key)
