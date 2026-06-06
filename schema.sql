-- Reference snapshot of the schema at Alembic head.
-- Authoritative schema changes live in backend/alembic/versions/.

create table if not exists users (
  id bigserial primary key,
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  role text not null default 'USER',
  is_disabled boolean not null default false,
  signature text not null default '' check (length(signature) <= 160),
  avatar_object_key text,
  avatar_content_type text,
  avatar_updated_at timestamptz,
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
  active_version_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists problem_versions (
  id bigserial primary key,
  problem_id bigint not null references problems(id) on delete cascade,
  version text not null,
  statement_md text not null default '',
  statement_assets_json jsonb not null default '{}'::jsonb,
  test_input_object_key text,
  test_input_bundle_object_key text,
  label_object_key text,
  sample_submission_object_key text,
  public_bundle_object_key text,
  private_bundle_object_key text,
  sample_bundle_object_key text,
  sample_bundle_filename text,
  output_files jsonb not null default '["submission.csv"]'::jsonb,
  scorer_object_key text,
  runner_image text not null default 'aioj-python-basic:latest',
  run_command jsonb not null default '["python","/workspace/predict.py","--input","/input/test.csv","--output","/output/submission.csv"]',
  required_tags text[] not null default '{}',
  status text not null default 'DRAFT',
  self_test_status text not null default 'PENDING',
  self_test_result jsonb,
  last_self_tested_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(problem_id, version)
);

alter table problems
  drop constraint if exists problems_active_version_id_fkey;

alter table problems
  add constraint problems_active_version_id_fkey
  foreign key (active_version_id) references problem_versions(id) on delete set null;

create table if not exists contests (
  id bigserial primary key,
  slug text unique not null,
  title text not null,
  description_md text not null default '',
  status text not null default 'DRAFT',
  start_at timestamptz,
  end_at timestamptz,
  visibility text not null default 'PUBLIC',
  registration_mode text not null default 'OPEN',
  invite_code text,
  hide_problems_before_start boolean not null default false,
  allow_join_after_start boolean not null default true,
  scoreboard_mode text not null default 'SCORE',
  penalty_minutes integer not null default 20,
  scoreboard_visible boolean not null default true,
  questions_enabled boolean not null default true,
  announcements_enabled boolean not null default true,
  freeze_at timestamptz,
  show_private_after_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists submissions (
  id bigserial primary key,
  user_id bigint references users(id),
  problem_id bigint not null references problems(id),
  problem_version_id bigint not null references problem_versions(id),
  contest_id bigint references contests(id) on delete set null,
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

create table if not exists contest_problems (
  contest_id bigint not null references contests(id) on delete cascade,
  problem_id bigint not null references problems(id) on delete cascade,
  display_order integer not null default 0,
  primary key (contest_id, problem_id)
);

create table if not exists contest_participants (
  contest_id bigint not null references contests(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  status text not null default 'ACCEPTED',
  invite_code_used text,
  note text,
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  primary key (contest_id, user_id)
);

create table if not exists contest_announcements (
  id bigserial primary key,
  contest_id bigint not null references contests(id) on delete cascade,
  title text not null,
  body_md text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contest_questions (
  id bigserial primary key,
  contest_id bigint not null references contests(id) on delete cascade,
  user_id bigint references users(id) on delete set null,
  title text not null,
  body_md text not null default '',
  answer_md text,
  status text not null default 'OPEN',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  answered_at timestamptz
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

create table if not exists system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body_md text not null default '',
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists direct_messages (
  id bigserial primary key,
  sender_id bigint not null references users(id) on delete cascade,
  recipient_id bigint not null references users(id) on delete cascade,
  body_md text not null,
  reply_to_message_id bigint references direct_messages(id) on delete set null,
  attachment_object_key text,
  attachment_content_type text,
  attachment_filename text,
  attachment_size_bytes integer,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id bigint references users(id) on delete set null,
  constraint direct_messages_no_self_check check (sender_id <> recipient_id),
  constraint direct_messages_content_check check (
    length(btrim(body_md)) between 1 and 4000
    or attachment_object_key is not null
  ),
  constraint direct_messages_attachment_size_check check (
    attachment_size_bytes is null or attachment_size_bytes between 1 and 20971520
  )
);

create table if not exists message_groups (
  id bigserial primary key,
  name text not null,
  owner_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_groups_name_length_check check (
    length(btrim(name)) between 1 and 80
  )
);

create table if not exists message_group_members (
  group_id bigint not null references message_groups(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  role text not null default 'MEMBER',
  group_nickname text,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id),
  constraint message_group_members_role_check check (role in ('OWNER', 'MEMBER')),
  constraint message_group_members_group_nickname_length_check check (
    group_nickname is null or length(btrim(group_nickname)) between 1 and 50
  )
);

create table if not exists group_messages (
  id bigserial primary key,
  group_id bigint not null references message_groups(id) on delete cascade,
  sender_id bigint not null references users(id) on delete cascade,
  body_md text not null default '',
  reply_to_message_id bigint references group_messages(id) on delete set null,
  attachment_object_key text,
  attachment_content_type text,
  attachment_filename text,
  attachment_size_bytes integer,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id bigint references users(id) on delete set null,
  constraint group_messages_content_check check (
    length(btrim(body_md)) between 1 and 4000
    or attachment_object_key is not null
  ),
  constraint group_messages_attachment_size_check check (
    attachment_size_bytes is null or attachment_size_bytes between 1 and 20971520
  )
);

create table if not exists group_message_reads (
  group_id bigint not null references message_groups(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  last_read_message_id bigint references group_messages(id) on delete set null,
  read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists message_conversation_preferences (
  user_id bigint not null references users(id) on delete cascade,
  conversation_type text not null,
  conversation_id bigint not null,
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  is_archived boolean not null default false,
  archived_at timestamptz,
  is_muted boolean not null default false,
  muted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_type, conversation_id),
  constraint message_conversation_preferences_type_check check (
    conversation_type in ('DIRECT', 'GROUP')
  )
);

create table if not exists user_message_blocks (
  blocker_id bigint not null references users(id) on delete cascade,
  blocked_user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint user_message_blocks_no_self_check check (blocker_id <> blocked_user_id)
);

create table if not exists message_reports (
  id bigserial primary key,
  reporter_id bigint not null references users(id) on delete cascade,
  direct_message_id bigint references direct_messages(id) on delete cascade,
  group_message_id bigint references group_messages(id) on delete cascade,
  reason text not null,
  details text not null default '',
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint message_reports_scope_check check (
    ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
  ),
  constraint message_reports_reason_length_check check (
    length(btrim(reason)) between 1 and 80
  ),
  constraint message_reports_details_length_check check (
    length(details) <= 2000
  ),
  constraint message_reports_status_check check (
    status in ('OPEN', 'REVIEWED', 'DISMISSED')
  )
);

create table if not exists message_hidden_entries (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  direct_message_id bigint references direct_messages(id) on delete cascade,
  group_message_id bigint references group_messages(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  constraint message_hidden_entries_scope_check check (
    ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
  ),
  constraint message_hidden_entries_unique_direct unique (user_id, direct_message_id),
  constraint message_hidden_entries_unique_group unique (user_id, group_message_id)
);

create table if not exists audit_logs (
  id bigserial primary key,
  user_id bigint references users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists judge_jobs_status_idx on judge_jobs(status, id);
create index if not exists judge_jobs_claimed_by_status_idx on judge_jobs(claimed_by, status, id);
create index if not exists judge_nodes_status_heartbeat_idx on judge_nodes(status, last_heartbeat_at desc);
create index if not exists submissions_problem_idx on submissions(problem_id, created_at desc);
create index if not exists leaderboard_problem_idx on leaderboard_entries(problem_id, public_score desc);
create index if not exists idx_submissions_contest_id on submissions(contest_id);
create index if not exists idx_contest_problems_contest_id on contest_problems(contest_id);
create index if not exists idx_contest_participants_contest_id on contest_participants(contest_id);
create index if not exists idx_contest_participants_user_id on contest_participants(user_id);
create index if not exists idx_contest_participants_status on contest_participants(contest_id, status);
create index if not exists idx_contest_announcements_contest_id on contest_announcements(contest_id);
create index if not exists idx_contest_questions_contest_id on contest_questions(contest_id);
create index if not exists idx_contest_questions_user_id on contest_questions(user_id);
create index if not exists idx_submissions_contest_scoreboard on submissions(contest_id, status, user_id, problem_id);
create index if not exists idx_submissions_contest_full_v6 on submissions(contest_id, user_id, problem_id, status, created_at);
create index if not exists idx_notifications_user_created_desc on notifications(user_id, created_at desc, id desc);
create index if not exists idx_notifications_user_unread on notifications(user_id, is_read, id desc);
create index if not exists idx_direct_messages_recipient_unread on direct_messages(recipient_id, is_read, created_at desc, id desc);
create index if not exists idx_direct_messages_sender_created on direct_messages(sender_id, created_at desc, id desc);
create index if not exists idx_direct_messages_reply_to on direct_messages(reply_to_message_id);
create index if not exists idx_direct_messages_conversation on direct_messages(
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at desc,
  id desc
);
create index if not exists idx_message_group_members_user on message_group_members(user_id, joined_at desc, group_id);
create index if not exists idx_group_messages_group_created on group_messages(group_id, created_at desc, id desc);
create index if not exists idx_group_messages_sender_created on group_messages(sender_id, created_at desc, id desc);
create index if not exists idx_group_messages_reply_to on group_messages(reply_to_message_id);
create index if not exists idx_group_message_reads_user on group_message_reads(user_id, group_id);
create index if not exists idx_message_conversation_preferences_user_flags on message_conversation_preferences(user_id, is_archived, is_pinned, is_muted, updated_at desc);
create index if not exists idx_user_message_blocks_blocked on user_message_blocks(blocked_user_id, blocker_id);
create index if not exists idx_message_reports_reporter_created on message_reports(reporter_id, created_at desc, id desc);
create index if not exists idx_message_reports_status_created on message_reports(status, created_at desc, id desc);
create index if not exists idx_message_hidden_entries_hidden_at on message_hidden_entries(user_id, hidden_at desc, id desc);
create index if not exists idx_audit_logs_created_desc on audit_logs(created_at desc, id desc);
create index if not exists idx_audit_logs_user_created on audit_logs(user_id, created_at desc, id desc);
create index if not exists idx_audit_logs_resource on audit_logs(resource_type, resource_id, created_at desc);
