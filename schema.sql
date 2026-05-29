create table if not exists users (
  id bigserial primary key,
  username text unique not null,
  email text unique not null,
  password_hash text not null,
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
  created_at timestamptz not null default now()
);

create table if not exists problem_versions (
  id bigserial primary key,
  problem_id bigint not null references problems(id) on delete cascade,
  version text not null,
  test_input_object_key text not null,
  label_object_key text not null,
  sample_submission_object_key text,
  runner_image text not null default 'aioj-python-basic:latest',
  run_command jsonb not null default '["python", "/workspace/predict.py", "--input", "/input/test.csv", "--output", "/output/submission.csv"]',
  created_at timestamptz not null default now(),
  unique(problem_id, version)
);

create table if not exists submissions (
  id bigserial primary key,
  user_id bigint references users(id),
  problem_id bigint not null references problems(id),
  problem_version_id bigint not null references problem_versions(id),

  status text not null default 'UPLOADED',

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
  best_submission_id bigint not null references submissions(id),
  public_score double precision,
  private_score double precision,
  updated_at timestamptz not null default now(),
  unique(problem_id, user_id)
);

create index if not exists submissions_problem_id_idx on submissions(problem_id);
create index if not exists submissions_status_idx on submissions(status);
create index if not exists judge_jobs_status_idx on judge_jobs(status);
