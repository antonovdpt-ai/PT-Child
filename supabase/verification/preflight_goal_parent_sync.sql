-- Run against the existing production database BEFORE drafting/applying a
-- uniqueness constraint or reconciling legacy publications. No patient text,
-- names, email, tokens, goal UUIDs or private Storage paths are returned.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select 'goal_publication_preflight' as check_name,
 (select count(*) from public.goals) as clinical_goals,
 (select count(*) from public.parent_goal_publications) as publications,
 (select count(*) from (
   select goal_id from public.parent_goal_publications
   group by goal_id having count(*) > 1
 ) d) as duplicate_goal_groups,
 (select count(*) from (
   select goal_id from public.parent_goal_publications
   where published_at is not null and unpublished_at is null
   group by goal_id having count(*) > 1
 ) d) as duplicate_active_goal_groups,
 (select count(*) from public.parent_goal_publications p
   left join public.goals g on g.id=p.goal_id
   where g.id is null or p.patient_id is distinct from g.patient_id
      or p.therapist_id is distinct from g.therapist_id) as ownership_mismatches,
 (select count(*) from public.parent_goal_publications p
   join public.goals g on g.id=p.goal_id
   where p.published_at is not null and p.unpublished_at is null
   and p.title is distinct from g.title) as active_custom_titles,
 (select count(*) from public.parent_goal_publications
   where published_at is not null and unpublished_at is null
   and description is not null) as active_custom_descriptions;

select status, count(*) as goals from public.goals group by status order by status;
select status, count(*) as publications from public.parent_goal_publications group by status order by status;
select column_name, data_type, is_nullable, column_default
 from information_schema.columns
 where table_schema='public' and table_name='parent_goal_publications'
 order by ordinal_position;
select indexname, indexdef from pg_indexes
 where schemaname='public' and tablename='parent_goal_publications'
 order by indexname;
rollback;
