-- Dossier Saskatchewan — les tables du site, dans le projet Supabase de DossierQuébec.
--
-- À exécuter UNE FOIS dans le projet Supabase de DQ : SQL Editor → coller → Run.
-- Re-exécutable sans erreur. Ne touche à AUCUNE table de DQ.
--
-- Même compte pour toute la famille Dossier (comme l'Ontario) : une personne connectée sur DQ
-- l'est aussi ici. Mais des tables À PART, préfixées sk_ :
--   - les projets de la Saskatchewan ont leurs propres identifiants (législature × 10 000 +
--     numéro : 300606 pour le n° 606) ;
--   - les plafonds de DQ comptent tous les suivis d'une personne : sans tables à part, suivre
--     3 dossiers au Québec empêcherait d'en suivre un seul en Saskatchewan ;
--   - les envois de courriels de DQ parcourent ses tables : ils ne doivent jamais tomber sur un
--     projet de la Saskatchewan.
--
-- Mêmes règles que DQ et l'Ontario :
--   - chaque personne ne voit et ne modifie que ses propres lignes (RLS) ;
--   - les plafonds s'appliquent ICI, pas dans le navigateur ;
--   - le public ne voit que des TOTAUX (sk_flag_counts), jamais qui a demandé quoi ;
--   - un compte de consultation (bibliothèque) ne peut rien écrire : même déclencheur que DQ
--     (public.refus_lecture_seule, défini par dossierquebec/scripts/supabase-schema-cadeaux.sql).


-- ---------------------------------------------------------------------------------------------
-- 1. « Demander une explication » (le challenge)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.sk_bill_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id bigint not null,                    -- 300606 = projet n° 606 de la 30e législature
  created_at timestamptz not null default now(),
  unique (user_id, bill_id)
);
alter table public.sk_bill_flags enable row level security;

-- 10 demandes par compte par 30 jours. Fonction security definer : une sous-requête directe dans
-- la policy déclenche « infinite recursion detected in policy ».
create or replace function public.sk_my_recent_flag_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.sk_bill_flags
  where user_id = auth.uid() and created_at > now() - interval '30 days';
$$;
revoke execute on function public.sk_my_recent_flag_count() from public, anon;
grant execute on function public.sk_my_recent_flag_count() to authenticated;

drop policy if exists "sk insert own flag" on public.sk_bill_flags;
drop policy if exists "sk select own flag" on public.sk_bill_flags;
drop policy if exists "sk delete own flag" on public.sk_bill_flags;
create policy "sk insert own flag" on public.sk_bill_flags for insert
  with check (auth.uid() = user_id and public.sk_my_recent_flag_count() < 10);
create policy "sk select own flag" on public.sk_bill_flags for select
  using (auth.uid() = user_id);
create policy "sk delete own flag" on public.sk_bill_flags for delete
  using (auth.uid() = user_id);
grant select, insert, delete on public.sk_bill_flags to authenticated;

-- Les totaux publics — jamais d'identité. Même forme que flag_counts() de DQ.
create or replace function public.sk_flag_counts()
returns table (bill_id bigint, cnt bigint)
language sql stable security definer set search_path = public as $$
  select bill_id, count(*)::bigint as cnt
  from public.sk_bill_flags
  group by bill_id
  having count(*) >= 1
  order by count(*) desc;
$$;
grant execute on function public.sk_flag_counts() to anon, authenticated;


-- ---------------------------------------------------------------------------------------------
-- 2. Les ministres et député·e·s suivis (même forme que follows de DQ)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.sk_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_type text not null check (person_type in ('minister', 'depute')),
  person_key text not null check (length(person_key) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (user_id, person_type, person_key)
);
alter table public.sk_follows enable row level security;

drop policy if exists "sk select own follows" on public.sk_follows;
drop policy if exists "sk insert own follows" on public.sk_follows;
drop policy if exists "sk delete own follows" on public.sk_follows;
create policy "sk select own follows" on public.sk_follows for select using (auth.uid() = user_id);
create policy "sk insert own follows" on public.sk_follows for insert with check (auth.uid() = user_id);
create policy "sk delete own follows" on public.sk_follows for delete using (auth.uid() = user_id);
grant select, insert, delete on public.sk_follows to authenticated;

-- Au plus 100 personnes suivies (il y a 61 député·e·s) : seulement contre l'abus.
create or replace function public.sk_limite_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.sk_follows where user_id = new.user_id) >= 100 then
    raise exception 'limite de 100 personnes suivies atteinte';
  end if;
  return new;
end;
$$;
drop trigger if exists sk_limite_follows on public.sk_follows;
create trigger sk_limite_follows before insert on public.sk_follows
  for each row execute function public.sk_limite_follows();


-- ---------------------------------------------------------------------------------------------
-- 3. Les projets de loi suivis (ils apparaissent dans « My file »)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.sk_bills_suivis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id bigint not null,
  numero text check (length(numero) <= 20),
  objet text check (length(objet) <= 600),
  created_at timestamptz not null default now(),
  unique (user_id, bill_id)
);
alter table public.sk_bills_suivis enable row level security;

drop policy if exists "sk select own bills" on public.sk_bills_suivis;
drop policy if exists "sk insert own bills" on public.sk_bills_suivis;
drop policy if exists "sk delete own bills" on public.sk_bills_suivis;
create policy "sk select own bills" on public.sk_bills_suivis for select using (auth.uid() = user_id);
create policy "sk insert own bills" on public.sk_bills_suivis for insert with check (auth.uid() = user_id);
create policy "sk delete own bills" on public.sk_bills_suivis for delete using (auth.uid() = user_id);
grant select, insert, delete on public.sk_bills_suivis to authenticated;

-- Au plus 10 projets suivis par personne. Un suivi déjà là passe (upsert sans doublon).
create or replace function public.sk_limite_bills_suivis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sk_bills_suivis where user_id = new.user_id and bill_id = new.bill_id) then
    return new;
  end if;
  if (select count(*) from public.sk_bills_suivis where user_id = new.user_id) >= 10 then
    raise exception 'limite de 10 projets suivis atteinte';
  end if;
  return new;
end;
$$;
drop trigger if exists sk_limite_bills_suivis on public.sk_bills_suivis;
create trigger sk_limite_bills_suivis before insert on public.sk_bills_suivis
  for each row execute function public.sk_limite_bills_suivis();


-- ---------------------------------------------------------------------------------------------
-- 4. Comptes de consultation : lecture seule sur les trois tables
-- ---------------------------------------------------------------------------------------------
drop trigger if exists refus_lecture_seule_sk_bill_flags on public.sk_bill_flags;
create trigger refus_lecture_seule_sk_bill_flags before insert or update or delete on public.sk_bill_flags
  for each row execute function public.refus_lecture_seule();
drop trigger if exists refus_lecture_seule_sk_follows on public.sk_follows;
create trigger refus_lecture_seule_sk_follows before insert or update or delete on public.sk_follows
  for each row execute function public.refus_lecture_seule();
drop trigger if exists refus_lecture_seule_sk_bills_suivis on public.sk_bills_suivis;
create trigger refus_lecture_seule_sk_bills_suivis before insert or update or delete on public.sk_bills_suivis
  for each row execute function public.refus_lecture_seule();
