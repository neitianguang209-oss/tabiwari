-- =====================================================================
-- たびわり（旅の立て替え・割り勘）  Supabase スキーマ
--
-- 既存プロジェクト gzayrjlhruhvklsidraw に相乗り。テーブルは tabiwari_ 接頭辞。
--
-- ログインは無し。旅行ごとのランダムなID（16文字）が「合言葉」になる。
-- テーブルは anon から直接は読めないように閉じ、IDを知っている人だけが
-- 下の関数（tabiwari_pull / tabiwari_push_batch）経由で読み書きできる。
-- ＝ 公開キーを使って他人の旅行を一覧・盗み見ることはできない。
--
-- 行の中身は jsonb の data にまとめて持つ（画面の項目を足してもDB変更が要らない）。
-- updated_at は端末側の更新時刻で、新しいほうだけが残る（後勝ち）。
-- synced_at はサーバーに届いた時刻で、差分取得のしおりに使う。
-- 削除は deleted フラグ（ソフト削除）だけ。物理削除はしない。
-- =====================================================================

create table if not exists public.tabiwari_trips (
  id          text primary key check (id ~ '^[A-Za-z0-9]{12,32}$'),
  data        jsonb not null,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now()
);

create table if not exists public.tabiwari_members (
  trip_id     text not null references public.tabiwari_trips(id) on delete cascade,
  id          text not null check (id ~ '^[A-Za-z0-9_-]{4,40}$'),
  data        jsonb not null,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now(),
  primary key (trip_id, id)
);

create table if not exists public.tabiwari_expenses (
  trip_id     text not null references public.tabiwari_trips(id) on delete cascade,
  id          text not null check (id ~ '^[A-Za-z0-9_-]{4,40}$'),
  data        jsonb not null,
  deleted     boolean not null default false,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now(),
  primary key (trip_id, id)
);

create index if not exists tabiwari_members_sync_idx  on public.tabiwari_members  (trip_id, synced_at);
create index if not exists tabiwari_expenses_sync_idx on public.tabiwari_expenses (trip_id, synced_at);

-- AIキーなどの秘密（Edge Function だけが service role で読む）
create table if not exists public.tabiwari_secret (
  k           text primary key,
  v           text not null,
  updated_at  timestamptz not null default now()
);

-- AI読み取りの回数（旅行ごと・1日ごと。無料枠を使い切らないための上限用）
create table if not exists public.tabiwari_ai_usage (
  trip_id     text not null,
  day         date not null,
  n           integer not null default 0,
  primary key (trip_id, day)
);

alter table public.tabiwari_trips     enable row level security;
alter table public.tabiwari_members   enable row level security;
alter table public.tabiwari_expenses  enable row level security;
alter table public.tabiwari_secret    enable row level security;
alter table public.tabiwari_ai_usage  enable row level security;
-- ポリシーは作らない ＝ anon / authenticated からは直接読めない・書けない
revoke all on public.tabiwari_trips, public.tabiwari_members, public.tabiwari_expenses,
              public.tabiwari_secret, public.tabiwari_ai_usage from anon, authenticated;


-- ---------------------------------------------------------------------
-- 差分の取得。p_since より後にサーバーへ届いた行だけ返す（null なら全部）。
-- 旅行が無ければ found=false（端末側に記録があれば、端末からの復元に使う）。
-- ---------------------------------------------------------------------
create or replace function public.tabiwari_pull(p_trip text, p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  t public.tabiwari_trips%rowtype;
begin
  if p_trip is null or p_trip !~ '^[A-Za-z0-9]{12,32}$' then
    raise exception 'bad trip id';
  end if;
  select * into t from public.tabiwari_trips where id = p_trip;
  if not found then
    return jsonb_build_object('found', false, 'now', now());
  end if;
  return jsonb_build_object(
    'found', true,
    'now', now(),
    'trip', case when p_since is null or t.synced_at > p_since then t.data end,
    'members', coalesce((
      select jsonb_agg(m.data order by m.synced_at)
      from public.tabiwari_members m
      where m.trip_id = p_trip and (p_since is null or m.synced_at > p_since)
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(e.data || jsonb_build_object('deleted', e.deleted) order by e.synced_at)
      from public.tabiwari_expenses e
      where e.trip_id = p_trip and (p_since is null or e.synced_at > p_since)
    ), '[]'::jsonb)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- まとめて書き込み。p_ops は [{kind:'trip'|'member'|'expense', data:{id, updatedAt, deleted?, ...}}]
-- 端末がオフラインの間にためた変更も、つながったときにこれ1回で送る。
-- 同じ行は updatedAt が新しいほうだけ残る（古い変更が後から届いても上書きしない）。
-- ---------------------------------------------------------------------
create or replace function public.tabiwari_push_batch(p_trip text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  op        jsonb;
  d         jsonb;
  k         text;
  rid       text;
  ts        timestamptz;
  v_now     timestamptz := clock_timestamp();
  n_applied integer := 0;
begin
  if p_trip is null or p_trip !~ '^[A-Za-z0-9]{12,32}$' then
    raise exception 'bad trip id';
  end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 500 then
    raise exception 'bad ops';
  end if;

  for op in select * from jsonb_array_elements(p_ops) loop
    k   := op->>'kind';
    d   := op->'data';
    if d is null or jsonb_typeof(d) <> 'object' then raise exception 'bad data'; end if;
    if pg_column_size(d) > 200000 then raise exception 'row too large'; end if;
    ts  := coalesce((d->>'updatedAt')::timestamptz, v_now);
    if ts > v_now + interval '1 day' then ts := v_now; end if;   -- 端末の時計が大きくずれていても未来の行で固定されないように

    if k = 'trip' then
      insert into public.tabiwari_trips as x (id, data, updated_at, synced_at)
      values (p_trip, d || jsonb_build_object('id', p_trip), ts, v_now)
      on conflict (id) do update
        set data = excluded.data, updated_at = excluded.updated_at, synced_at = v_now
        where x.updated_at <= excluded.updated_at;

    elsif k = 'member' then
      rid := d->>'id';
      if not exists (select 1 from public.tabiwari_trips where id = p_trip) then raise exception 'trip not found'; end if;
      if (select count(*) from public.tabiwari_members where trip_id = p_trip) >= 60 then raise exception 'too many members'; end if;
      insert into public.tabiwari_members as x (trip_id, id, data, updated_at, synced_at)
      values (p_trip, rid, d, ts, v_now)
      on conflict (trip_id, id) do update
        set data = excluded.data, updated_at = excluded.updated_at, synced_at = v_now
        where x.updated_at <= excluded.updated_at;

    elsif k = 'expense' then
      rid := d->>'id';
      if not exists (select 1 from public.tabiwari_trips where id = p_trip) then raise exception 'trip not found'; end if;
      insert into public.tabiwari_expenses as x (trip_id, id, data, deleted, updated_at, synced_at)
      values (p_trip, rid, d - 'deleted', coalesce((d->>'deleted')::boolean, false), ts, v_now)
      on conflict (trip_id, id) do update
        set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, synced_at = v_now
        where x.updated_at <= excluded.updated_at;

    else
      raise exception 'bad kind %', k;
    end if;
    n_applied := n_applied + 1;
  end loop;

  return jsonb_build_object('ok', true, 'applied', n_applied, 'at', v_now);
end;
$$;


-- ---------------------------------------------------------------------
-- 週次バックアップ用（C:\Users\ひかる\.claude\backup-supabase.ps1 が呼ぶ）。
-- テーブルは閉じているので、合言葉（端末の PC にだけある）を知っている場合だけ全件を返す。
-- ---------------------------------------------------------------------
create or replace function public.tabiwari_backup_dump(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  want text;
begin
  select v into want from public.tabiwari_secret where k = 'backup_token_sha256';
  if want is null or p_token is null or encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> want then
    raise exception 'denied';
  end if;
  return jsonb_build_object(
    'at', now(),
    'trips',    coalesce((select jsonb_agg(to_jsonb(t)) from public.tabiwari_trips t), '[]'::jsonb),
    'members',  coalesce((select jsonb_agg(to_jsonb(m)) from public.tabiwari_members m), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(to_jsonb(e)) from public.tabiwari_expenses e), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.tabiwari_pull(text, timestamptz)        from public;
revoke all on function public.tabiwari_push_batch(text, jsonb)        from public;
revoke all on function public.tabiwari_backup_dump(text)              from public;
grant execute on function public.tabiwari_pull(text, timestamptz)     to anon, authenticated;
grant execute on function public.tabiwari_push_batch(text, jsonb)     to anon, authenticated;
grant execute on function public.tabiwari_backup_dump(text)           to anon, authenticated;
