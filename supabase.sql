-- Radar Tech Junior : suivi des candidatures, une ligne par entreprise ou offre suivie.
-- À coller une fois dans Supabase → SQL Editor → Run.
-- Sécurité : chaque personne connectée ne peut lire et modifier que ses propres lignes (Row Level Security).

create table if not exists public.suivi (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item       text        not null check (char_length(item) <= 80),          -- « ent:<siren>-<région> » ou « off:<id offre> »
  type       text        not null check (type in ('ent', 'off')),
  label      text        check (char_length(label) <= 300),
  statut     text        not null check (statut in ('a_contacter', 'candidate', 'relance', 'entretien', 'refus', 'accepte')),
  note       text        check (char_length(note) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table public.suivi enable row level security;

drop policy if exists "suivi : lecture" on public.suivi;
drop policy if exists "suivi : ajout" on public.suivi;
drop policy if exists "suivi : modification" on public.suivi;
drop policy if exists "suivi : suppression" on public.suivi;

create policy "suivi : lecture"      on public.suivi for select to authenticated using ((select auth.uid()) = user_id);
create policy "suivi : ajout"        on public.suivi for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "suivi : modification" on public.suivi for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "suivi : suppression"  on public.suivi for delete to authenticated using ((select auth.uid()) = user_id);

-- Les visiteurs non connectés n'ont aucun accès à la table.
revoke all on public.suivi from anon;
grant select, insert, update, delete on public.suivi to authenticated;
