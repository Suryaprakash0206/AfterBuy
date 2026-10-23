-- Claim/recovery timestamps survive Redis loss and worker restarts.
alter table public.documents add column index_started_at timestamptz;

-- A reconciliation scan can race a coverage/profile edit. Reject the stale
-- schedule at insertion, in addition to checking it again at delivery.
create function public.guard_reminder_source() returns trigger language plpgsql security definer set search_path=public as $$
declare c coverage; p profiles; begin
 if new.coverage_id is not null then
  select * into c from coverage where id=new.coverage_id and workspace_id=new.workspace_id for share;
  select * into p from profiles where id=new.user_id for share;
  if c.product_id is distinct from new.product_id then raise exception 'Reminder product does not match coverage'; end if;
  if not c.confirmed or not p.reminders_enabled or new.source_revision is distinct from c.revision::text||'-'||p.revision::text then return null; end if;
 end if;
 if new.case_id is not null and not exists(select 1 from service_cases where id=new.case_id and workspace_id=new.workspace_id and product_id=new.product_id) then raise exception 'Reminder product does not match case'; end if;
 return new; end $$;
create trigger guard_reminder_source before insert on public.reminders for each row execute function public.guard_reminder_source();
revoke execute on function public.guard_reminder_source() from public,anon,authenticated;
grant execute on function public.guard_reminder_source() to service_role;
