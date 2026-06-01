"""Add problem statement assets and artifact bundle metadata.

Revision ID: 20260601_0008
Revises: 20260531_0007
Create Date: 2026-06-01 17:30:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260601_0008"
down_revision = "20260531_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table problem_versions
        add column if not exists statement_assets_json jsonb not null default '{}'::jsonb,
        add column if not exists test_input_bundle_object_key text,
        add column if not exists public_bundle_object_key text,
        add column if not exists private_bundle_object_key text,
        add column if not exists sample_bundle_object_key text,
        add column if not exists sample_bundle_filename text,
        add column if not exists output_files jsonb not null default '["submission.csv"]'::jsonb;

        alter table problem_versions
        alter column test_input_object_key drop not null,
        alter column label_object_key drop not null,
        alter column sample_submission_object_key drop not null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table problem_versions
        drop column if exists output_files,
        drop column if exists sample_bundle_filename,
        drop column if exists sample_bundle_object_key,
        drop column if exists private_bundle_object_key,
        drop column if exists public_bundle_object_key,
        drop column if exists test_input_bundle_object_key,
        drop column if exists statement_assets_json;

        alter table problem_versions
        alter column test_input_object_key set not null,
        alter column label_object_key set not null,
        alter column sample_submission_object_key set not null;
        """
    )
