-- =============================================================================
-- Visus – Supabase šema
-- Pokrenuti jednom u Supabase Dashboard → SQL Editor (ceo fajl odjednom).
-- Bezbedno je pokrenuti ponovo: koristi "if not exists" / "create or replace".
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Privatne šeme: nisu izložene preko API-ja (anon / authenticated nemaju pristup)
-- -----------------------------------------------------------------------------
create schema if not exists private;
create schema if not exists research;
revoke all on schema private from public, anon, authenticated;
revoke all on schema research from public, anon, authenticated;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);
-- Tajni ključ za pseudonime istraživačkih zapisa (generiše se jednom).
insert into private.settings (key, value)
values ('research_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Tier 1 – anonimni istraživački podaci. Bez user id-a, bez beleški.
create table if not exists research.records (
  id        bigint generated always as identity primary key,
  pseudonym text        not null,
  timestamp timestamptz not null,
  period    text        not null,
  dryness   smallint    not null,
  clarity   smallint    not null,
  fatigue   smallint    not null,
  redness   smallint    not null,
  light     smallint    not null,
  eye_crop  bytea
);
create index if not exists records_pseudonym_idx on research.records (pseudonym);
-- v1.1: prisutni simptomi i stanje hitnosti
alter table research.records add column if not exists symptoms text[] not null default '{}';
alter table research.records add column if not exists urgency  text;

-- Trenutna verzija politike privatnosti. Kada se promeni, korisnici ponovo daju saglasnost.
-- Mora da se poklapa sa CONSENT_VERSION u public/app/rules.js.
create or replace function private.current_consent_version()
returns text language sql immutable as $$ select '1.1' $$;

-- -----------------------------------------------------------------------------
-- Tier 2 – lični podaci
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  name                text check (char_length(name) <= 80),
  timezone            text not null default 'Europe/Belgrade',
  consent_version     text,
  consent_accepted_at timestamptz,
  research_opt_in     boolean not null default false,
  demographics        jsonb not null default '{}' check (jsonb_typeof(demographics) = 'object'),
  notifications       jsonb not null default '{"enabled": false, "morning": "08:00", "working": "13:00", "evening": "20:30"}'
                        check (jsonb_typeof(notifications) = 'object'),
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  period      text not null check (period in ('morning', 'working', 'evening')),
  dryness     smallint not null check (dryness between 1 and 5),
  clarity     smallint not null check (clarity between 1 and 5),
  fatigue     smallint not null check (fatigue between 1 and 5),
  redness     smallint not null check (redness between 1 and 5),
  light       smallint not null check (light between 1 and 5),
  note        text not null default '' check (char_length(note) <= 500),
  retroactive boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, date, period)
);
create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- v1.1: prisutni simptomi (više izbora) i stanje hitnosti. Ključevi = SYMPTOMS / URGENCY u rules.js.
alter table public.entries add column if not exists symptoms text[] not null default '{}';
alter table public.entries add column if not exists urgency  text;
-- Opis za simptom "Drugo" – ostaje samo u ličnom dnevniku, ne kopira se u istraživanje.
alter table public.entries add column if not exists symptom_other text check (char_length(symptom_other) <= 120);
alter table public.entries drop constraint if exists entries_symptoms_check;
alter table public.entries add constraint entries_symptoms_check check (
  symptoms <@ array['tearing', 'discharge', 'red_eye', 'foreign_body', 'burning', 'itching', 'pain', 'pressure', 'reduced_acuity', 'other']::text[]);
alter table public.entries drop constraint if exists entries_urgency_check;
alter table public.entries add constraint entries_urgency_check check (urgency in ('usual', 'sudden', 'doctor'));

create table if not exists public.consent_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('app', 'research')),
  granted    boolean not null,
  version    text not null,
  created_at timestamptz not null default now()
);
create index if not exists consent_events_user_idx on public.consent_events (user_id);

create table if not exists public.redemptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  milestone_id text not null,
  code         text not null unique,
  created_at   timestamptz not null default now(),
  redeemed_at  timestamptz,
  unique (user_id, milestone_id)
);

create table if not exists public.waitlist (
  email      text primary key check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(email) <= 254),
  platform   text check (platform in ('ios', 'android', 'both')),
  consent    boolean not null check (consent),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Pomoćne funkcije
-- -----------------------------------------------------------------------------

-- Današnji datum u vremenskoj zoni korisnika.
create or replace function private.user_today(p_user uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.profiles where id = p_user), 'Europe/Belgrade'))::date
$$;

create or replace function private.pseudonym(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_user::text, (select value from private.settings where key = 'research_pepper'), 'sha256'), 'hex')
$$;

-- XP = unosi × 15 + (aktivan niz ≥ 3 dana) × 5. Ista pravila kao computeStats() u rules.js.
create or replace function private.user_xp(p_user uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  v_today  date := private.user_today(p_user);
  v_start  date;
  v_streak integer := 0;
  v_count  integer;
begin
  select count(*) into v_count from public.entries where user_id = p_user;

  if exists (select 1 from public.entries where user_id = p_user and date = v_today and not retroactive) then
    v_start := v_today;
  else
    v_start := v_today - 1;
  end if;
  while exists (select 1 from public.entries where user_id = p_user and date = v_start - v_streak and not retroactive) loop
    v_streak := v_streak + 1;
  end loop;

  return v_count * 15 + (case when v_streak >= 3 then v_streak else 0 end) * 5;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggeri
-- -----------------------------------------------------------------------------

-- Novi nalog → prazan profil.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 80), ''));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Profil: zaštita polja + dnevnik saglasnosti.
create or replace function private.profiles_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;

  -- Vremenska zona mora biti ispravna (inače baca grešku).
  perform now() at time zone new.timezone;

  if new.consent_version is distinct from old.consent_version then
    if new.consent_version is distinct from private.current_consent_version() then
      raise exception 'Neispravna verzija saglasnosti' using errcode = 'check_violation';
    end if;
    new.consent_accepted_at := now();
    insert into public.consent_events (user_id, kind, granted, version)
    values (new.id, 'app', true, new.consent_version);
  else
    new.consent_accepted_at := old.consent_accepted_at;
  end if;

  if old.onboarded_at is not null then
    new.onboarded_at := old.onboarded_at;
  elsif new.onboarded_at is not null then
    if new.consent_version is distinct from private.current_consent_version() then
      raise exception 'Saglasnost je obavezna' using errcode = 'check_violation';
    end if;
    new.onboarded_at := now();
  end if;

  -- Izbor o istraživanju se beleži pri završetku podešavanja i pri svakoj promeni.
  if new.research_opt_in is distinct from old.research_opt_in
     or (old.onboarded_at is null and new.onboarded_at is not null) then
    insert into public.consent_events (user_id, kind, granted, version)
    values (new.id, 'research', new.research_opt_in, private.current_consent_version());
  end if;

  return new;
end;
$$;
drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function private.profiles_before_update();

-- Unos: datum ne sme biti u budućnosti, "naknadni" se računa na serveru.
create or replace function private.entries_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
  v_profile public.profiles;
begin
  new.user_id := auth.uid();
  if new.user_id is null then
    raise exception 'Niste prijavljeni' using errcode = 'insufficient_privilege';
  end if;

  select * into v_profile from public.profiles where id = new.user_id;
  if v_profile.onboarded_at is null or v_profile.consent_version is distinct from private.current_consent_version() then
    raise exception 'Prvo završite podešavanje naloga' using errcode = 'insufficient_privilege';
  end if;

  v_today := private.user_today(new.user_id);
  if new.date > v_today then
    raise exception 'Datum ne može biti u budućnosti' using errcode = 'check_violation';
  end if;

  if new.urgency is null then
    raise exception 'Izaberite kakvo je stanje (uobičajeno, naglo nastalo ili potreban oftalmolog)' using errcode = 'check_violation';
  end if;
  new.symptoms := array(select distinct unnest(coalesce(new.symptoms, '{}')) order by 1);
  new.symptom_other := case when 'other' = any(new.symptoms) then nullif(btrim(new.symptom_other), '') end;
  new.note := btrim(coalesce(new.note, ''));
  new.retroactive := new.date <> v_today;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists entries_before_insert on public.entries;
create trigger entries_before_insert before insert on public.entries
  for each row execute function private.entries_before_insert();

-- Izmena: menjaju se samo ocene i beleška.
create or replace function private.entries_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.date := old.date;
  new.period := old.period;
  new.retroactive := old.retroactive;
  new.created_at := old.created_at;
  new.symptoms := array(select distinct unnest(coalesce(new.symptoms, '{}')) order by 1);
  new.symptom_other := case when 'other' = any(new.symptoms) then nullif(btrim(new.symptom_other), '') end;
  new.note := btrim(coalesce(new.note, ''));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists entries_before_update on public.entries;
create trigger entries_before_update before update on public.entries
  for each row execute function private.entries_before_update();

-- Kopija za istraživanje (Tier 1), samo ako je korisnik pristao.
create or replace function private.entries_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select research_opt_in from public.profiles where id = new.user_id) then
    insert into research.records (pseudonym, timestamp, period, dryness, clarity, fatigue, redness, light, symptoms, urgency)
    values (private.pseudonym(new.user_id), new.created_at, new.period, new.dryness, new.clarity, new.fatigue, new.redness, new.light,
            new.symptoms, new.urgency);
  end if;
  return new;
end;
$$;
drop trigger if exists entries_after_insert on public.entries;
create trigger entries_after_insert after insert on public.entries
  for each row execute function private.entries_after_insert();

-- -----------------------------------------------------------------------------
-- RPC funkcije (pozivaju se iz aplikacije: supabase.rpc(...))
-- -----------------------------------------------------------------------------

-- Preuzimanje nagrade: proverava nivo na serveru i generiše jednokratni kod.
create or replace function public.claim_reward(p_milestone text)
returns public.redemptions language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_required integer;
  v_row public.redemptions;
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  if v_user is null then
    raise exception 'Niste prijavljeni' using errcode = 'insufficient_privilege';
  end if;

  -- XP prag nivoa na kome se nagrada otključava (LEVELS / MILESTONES u rules.js).
  v_required := case p_milestone when 'm3' then 150 when 'm5' then 500 when 'm7' then 1050 when 'm10' then 2300 end;
  if v_required is null then
    raise exception 'Nepoznata nagrada' using errcode = 'check_violation';
  end if;

  select * into v_row from public.redemptions where user_id = v_user and milestone_id = p_milestone;
  if found then
    return v_row;
  end if;

  if private.user_xp(v_user) < v_required then
    raise exception 'Nagrada još nije otključana' using errcode = 'insufficient_privilege';
  end if;

  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := 'VIZ-';
    for i in 0..7 loop
      if i = 4 then v_code := v_code || '-'; end if;
      v_code := v_code || substr(v_chars, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.redemptions where code = v_code);
  end loop;

  insert into public.redemptions (user_id, milestone_id, code)
  values (v_user, p_milestone, v_code)
  returning * into v_row;
  return v_row;
end;
$$;

-- Šta je korisnik podelio sa istraživanjem (transparentnost).
create or replace function public.research_preview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_pseudonym text;
  v_last research.records;
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni' using errcode = 'insufficient_privilege';
  end if;
  v_pseudonym := private.pseudonym(auth.uid());
  select * into v_last from research.records where pseudonym = v_pseudonym order by id desc limit 1;
  return jsonb_build_object(
    'count', (select count(*) from research.records where pseudonym = v_pseudonym),
    'last', case when v_last.id is null then null else jsonb_build_object(
      'pseudonym', v_last.pseudonym,
      'timestamp', v_last.timestamp,
      'period', v_last.period,
      'scores', jsonb_build_object('dryness', v_last.dryness, 'clarity', v_last.clarity, 'fatigue', v_last.fatigue,
                                   'redness', v_last.redness, 'light', v_last.light),
      'symptoms', to_jsonb(v_last.symptoms),
      'urgency', v_last.urgency,
      'eyeCrop', null) end
  );
end;
$$;

-- Brisanje naloga: briše auth korisnika, sve ostalo se briše kaskadno.
-- Pseudonimni istraživački zapisi ostaju u arhivi.
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin (istraživački tim): vidi samo anonimne istraživačke zapise i ukupne brojeve.
-- Admin se dodaje isključivo ovde, u SQL Editoru (aplikacija to ne može):
--   insert into private.admins (user_id)
--   select id from auth.users where email = 'ADMIN-EMAIL';
-- -----------------------------------------------------------------------------
create table if not exists private.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = auth.uid())
$$;

create or replace function private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.admins where user_id = auth.uid()) then
    raise exception 'Nemate administratorski pristup' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Ukupni brojevi – bez ikakvih ličnih podataka.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'users',                 (select count(*) from public.profiles where onboarded_at is not null),
    'research_participants', (select count(*) from public.profiles where research_opt_in),
    'entries',               (select count(*) from public.entries),
    'research_records',      (select count(*) from research.records),
    'waitlist',              (select count(*) from public.waitlist)
  );
end;
$$;

-- Anonimni istraživački zapisi (Tier 1) za izabrani period.
-- (drop jer se promenio oblik rezultata; create or replace to ne dozvoljava)
drop function if exists public.admin_research(timestamptz, timestamptz);
create function public.admin_research(p_from timestamptz default null, p_to timestamptz default null)
returns table (pseudonym text, "timestamp" timestamptz, period text,
               dryness smallint, clarity smallint, fatigue smallint, redness smallint, light smallint,
               symptoms text[], urgency text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  return query
    select r.pseudonym, r.timestamp, r.period, r.dryness, r.clarity, r.fatigue, r.redness, r.light, r.symptoms, r.urgency
    from research.records r
    where (p_from is null or r.timestamp >= p_from)
      and (p_to is null or r.timestamp < p_to)
    order by r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prava pristupa i Row Level Security
-- -----------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.claim_reward(text), public.research_preview(), public.delete_account() from public, anon;
grant execute on function public.claim_reward(text), public.research_preview(), public.delete_account() to authenticated;
revoke all on function public.is_admin(), public.admin_overview(), public.admin_research(timestamptz, timestamptz) from public, anon;
grant execute on function public.is_admin(), public.admin_overview(), public.admin_research(timestamptz, timestamptz) to authenticated;

revoke all on public.profiles, public.entries, public.consent_events, public.redemptions, public.waitlist from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
grant select on public.consent_events, public.redemptions to authenticated;
grant insert on public.waitlist to anon, authenticated;

-- Interne tabele: nisu dostupne preko API-ja, RLS je dodatni sloj zaštite.
-- Funkcije koje ih koriste rade kao vlasnik tabele, pa RLS na njih ne utiče.
alter table private.settings      enable row level security;
alter table research.records      enable row level security;
alter table private.admins        enable row level security;

alter table public.profiles       enable row level security;
alter table public.entries        enable row level security;
alter table public.consent_events enable row level security;
alter table public.redemptions    enable row level security;
alter table public.waitlist       enable row level security;

drop policy if exists "profil: čitanje svog" on public.profiles;
create policy "profil: čitanje svog" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profil: izmena svog" on public.profiles;
create policy "profil: izmena svog" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "unosi: svoji" on public.entries;
create policy "unosi: svoji" on public.entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "saglasnosti: čitanje svojih" on public.consent_events;
create policy "saglasnosti: čitanje svojih" on public.consent_events for select to authenticated using (user_id = auth.uid());

drop policy if exists "nagrade: čitanje svojih" on public.redemptions;
create policy "nagrade: čitanje svojih" on public.redemptions for select to authenticated using (user_id = auth.uid());

drop policy if exists "lista čekanja: upis" on public.waitlist;
create policy "lista čekanja: upis" on public.waitlist for insert to anon, authenticated with check (consent);
