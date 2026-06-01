from sqlalchemy import text


def latest_problem_version(conn, slug: str, public_only: bool = True):
    if public_only:
        return conn.execute(
            text(
                """
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
                    p.active_version_id,
                    coalesce(nullif(pv.statement_md, ''), p.statement_md) as statement_md,
                    pv.statement_assets_json,
                    pv.id as problem_version_id,
                    pv.version,
                    pv.test_input_object_key,
                    pv.test_input_bundle_object_key,
                    pv.label_object_key,
                    pv.sample_submission_object_key,
                    pv.public_bundle_object_key,
                    pv.private_bundle_object_key,
                    pv.sample_bundle_object_key,
                    pv.sample_bundle_filename,
                    pv.output_files,
                    pv.scorer_object_key,
                    pv.runner_image,
                    pv.run_command,
                    pv.required_tags,
                    pv.status as version_status,
                    pv.self_test_status,
                    pv.self_test_result,
                    pv.last_self_tested_at,
                    pv.activated_at
                from problems p
                join problem_versions pv on pv.id = p.active_version_id
                where p.slug = :slug
                  and p.status = 'PUBLIC'
                  and pv.status = 'ACTIVE'
                limit 1
                """
            ),
            {"slug": slug},
        ).mappings().first()

    return conn.execute(
        text(
            """
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
                p.active_version_id,
                coalesce(nullif(pv.statement_md, ''), p.statement_md) as statement_md,
                pv.statement_assets_json,
                pv.id as problem_version_id,
                pv.version,
                pv.test_input_object_key,
                pv.test_input_bundle_object_key,
                pv.label_object_key,
                pv.sample_submission_object_key,
                pv.public_bundle_object_key,
                pv.private_bundle_object_key,
                pv.sample_bundle_object_key,
                pv.sample_bundle_filename,
                pv.output_files,
                pv.scorer_object_key,
                pv.runner_image,
                pv.run_command,
                pv.required_tags,
                pv.status as version_status,
                pv.self_test_status,
                pv.self_test_result,
                pv.last_self_tested_at,
                pv.activated_at
            from problems p
            join problem_versions pv on pv.problem_id = p.id
            where p.slug = :slug
            order by pv.created_at desc, pv.id desc
            limit 1
            """
        ),
        {"slug": slug},
    ).mappings().first()
