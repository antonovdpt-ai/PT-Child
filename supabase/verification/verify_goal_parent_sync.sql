\set ON_ERROR_STOP on
begin read only;
set local statement_timeout='30s';
set local lock_timeout='3s';
\ir verify_goal_parent_sync_definitions.sql
do $$ begin
 if exists(select 1 from public.parent_goal_publications group by goal_id having count(*)>1) then raise exception 'STOP: duplicate goal publication';end if;
 if not exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attname='goal_id'
  where i.indexrelid=to_regclass('public.parent_goal_publications_goal_unique')
  and i.indrelid='public.parent_goal_publications'::regclass and i.indisunique and i.indisvalid
  and i.indnkeyatts=1 and i.indkey[0]=a.attnum and i.indpred is null and i.indexprs is null) then raise exception 'STOP: missing safe goal uniqueness';end if;
 if has_table_privilege('authenticated','public.parent_goal_publications','INSERT')
  or has_table_privilege('authenticated','public.parent_goal_publications','UPDATE')
  or has_table_privilege('authenticated','public.parent_goal_publications','DELETE') then raise exception 'STOP: independent publication writes remain';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='goals' and column_name='parent_visible' and data_type='boolean' and is_nullable='NO' and column_default='false') then raise exception 'STOP: unsafe private default';end if;
 if (select count(*) from pg_trigger where tgrelid='public.goals'::regclass and tgname in ('normalize_goal_completion','sync_goal_parent_projection') and tgenabled='O' and not tgisinternal)<>2 then raise exception 'STOP: missing goal triggers';end if;
end $$;
select 'GOAL_PARENT_SYNC_VERIFIED' as result;
rollback;
