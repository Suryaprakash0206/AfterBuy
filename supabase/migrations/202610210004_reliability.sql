-- Final invariants and atomic recurrence recovery.
create function public.touch_product() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger touch_product before update on public.products for each row execute function public.touch_product();
create function public.guard_case_event_status() returns trigger language plpgsql as $$ begin if new.status<>'Draft' then raise exception 'New cases must begin in Draft'; end if; return new; end $$;
create trigger new_case_status before insert on public.service_cases for each row execute function public.guard_case_event_status();
-- The recurrence is committed with delivery. A crash after commit cannot lose the next schedule.
create function public.schedule_recurrence() returns trigger language plpgsql security definer set search_path=public as $$
declare r reminders; p profiles; next_due timestamptz; begin
 select * into r from reminders where id=new.reminder_id;
 if r.repeat_months is null then return new; end if;
 select * into p from profiles where id=r.user_id;
 next_due=((r.due_at at time zone p.timezone)+make_interval(months=>r.repeat_months)) at time zone p.timezone;
 while next_due<=now() loop next_due=((next_due at time zone p.timezone)+make_interval(months=>r.repeat_months)) at time zone p.timezone; end loop;
 insert into reminders(workspace_id,user_id,product_id,case_id,kind,title,due_at,repeat_months,source_key)
 values(r.workspace_id,r.user_id,r.product_id,r.case_id,r.kind,r.title,next_due,r.repeat_months,'recurrence-'||r.id::text) on conflict(source_key) do nothing;
 return new; end $$;
create trigger schedule_recurrence after insert on public.notifications for each row execute function public.schedule_recurrence();
create function public.cleanup_document_messages() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if new.status='deleting' and old.status<>'deleting' then delete from messages where workspace_id=new.workspace_id and sources @> jsonb_build_array(jsonb_build_object('document_id',new.id::text)); end if; return new; end $$;
create trigger cleanup_document_messages after update on public.documents for each row execute function public.cleanup_document_messages();
create function public.guard_document_chunks() returns trigger language plpgsql security definer set search_path=public as $$ begin
 perform 1 from documents where id=new.document_id and workspace_id=new.workspace_id and status<>'deleting' for share;
 if not found then raise exception 'Document is unavailable'; end if; return new; end $$;
create trigger guard_document_chunks before insert or update on public.document_chunks for each row execute function public.guard_document_chunks();
create function public.request_reindex(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 update documents set index_status='pending' where id=p_id and workspace_id=w and status in ('needs_review','completed'); end $$;
create function public.audit_record_change() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(coalesce(new.workspace_id,old.workspace_id),auth.uid(),tg_table_name||'.'||lower(tg_op),coalesce(new.id,old.id));return coalesce(new,old);end $$;
create trigger audit_product after insert or update or delete on public.products for each row execute function public.audit_record_change();
create trigger audit_coverage after insert or update or delete on public.coverage for each row execute function public.audit_record_change();
create trigger audit_case after insert or update or delete on public.service_cases for each row execute function public.audit_record_change();
revoke execute on function public.touch_product(),public.guard_case_event_status(),public.schedule_recurrence(),public.cleanup_document_messages(),public.guard_document_chunks(),public.request_reindex(uuid,uuid),public.audit_record_change() from public,anon,authenticated;
grant execute on function public.request_reindex(uuid,uuid) to authenticated;
grant execute on function public.touch_product(),public.guard_case_event_status(),public.schedule_recurrence(),public.cleanup_document_messages(),public.guard_document_chunks(),public.request_reindex(uuid,uuid),public.audit_record_change() to service_role;
