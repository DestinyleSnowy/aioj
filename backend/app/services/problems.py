from sqlalchemy import text


def latest_problem_version(conn, slug: str, public_only: bool = True):
    status_filter = "and p.status = 'PUBLIC'" if public_only else ""
    return conn.execute(
        text(
            f"""
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
            """
        ),
        {"slug": slug},
    ).mappings().first()
