set search_path=public,extensions;
create function public.create_workspace(p_name text,p_kind text default 'personal') returns uuid language plpgsql security definer set search_path=public as $$ declare w uuid; begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verify your email first' using errcode='42501'; end if;
 if p_kind not in ('personal','household') then raise exception 'Invalid workspace type'; end if;
 if p_kind='personal' then select id into w from workspaces where created_by=auth.uid() and kind='personal'; if w is not null then return w; end if; end if;
 insert into workspaces(name,kind,created_by) values(p_name,p_kind,auth.uid()) returning id into w;
 insert into memberships values(w,auth.uid(),'owner',now());
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(w,auth.uid(),'workspace.created',w); return w; end $$;

create function public.create_invitation(w uuid,p_email text,p_role text) returns text language plpgsql security definer set search_path=public,extensions as $$ declare token text; begin
 if workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
 if not exists(select 1 from workspaces where id=w and kind='household') then raise exception 'Create a household workspace to invite members'; end if;
 if p_role not in ('editor','viewer') or length(p_email)>320 or p_email !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'Invalid invitation'; end if;
 token=encode(gen_random_bytes(32),'hex');
 update invitations set revoked_at=now() where workspace_id=w and lower(email)=lower(p_email) and accepted_at is null and revoked_at is null;
 insert into invitations(workspace_id,email,role,token_hash,expires_at,created_by) values(w,lower(trim(p_email)),p_role,encode(digest(token,'sha256'),'hex'),now()+interval '7 days',auth.uid());
 insert into audit_events(workspace_id,actor_id,action) values(w,auth.uid(),'invitation.created'); return token; end $$;
create function public.accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path=public,extensions as $$ declare i invitations; e text; begin
 select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then raise exception 'A verified account is required' using errcode='42501'; end if;
 select * into i from invitations where token_hash=encode(digest(p_token,'sha256'),'hex') for update;
 if i.id is null or i.accepted_at is not null or i.revoked_at is not null or i.expires_at<=now() or i.email<>e then raise exception 'Invitation is invalid, expired, or belongs to another account' using errcode='42501'; end if;
 perform create_workspace('My personal workspace','personal');
 insert into memberships(workspace_id,user_id,role) values(i.workspace_id,auth.uid(),i.role) on conflict(workspace_id,user_id) do nothing;
 update invitations set accepted_at=now() where id=i.id;
 insert into audit_events(workspace_id,actor_id,action) values(i.workspace_id,auth.uid(),'invitation.accepted'); return i.workspace_id; end $$;
create function public.manage_member(w uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path=public as $$ begin
 perform 1 from workspaces where id=w for update;
 if workspace_role(w) is distinct from 'owner' or p_user=auth.uid() or exists(select 1 from memberships where workspace_id=w and user_id=p_user and role='owner') then raise exception 'Cannot change this membership' using errcode='42501'; end if;
 if p_role is null then delete from memberships where workspace_id=w and user_id=p_user;
 elsif p_role in ('editor','viewer') then update memberships set role=p_role where workspace_id=w and user_id=p_user;
 else raise exception 'Invalid role'; end if;
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(w,auth.uid(),'membership.changed',p_user); end $$;
create function public.list_members(w uuid) returns table(user_id uuid,role text,display_name text,email text) language plpgsql security definer set search_path=public as $$ begin
 if workspace_role(w) is null then raise exception 'Access denied' using errcode='42501'; end if;
 return query select m.user_id,m.role,p.display_name,case when workspace_role(w)='owner' then u.email::text else null::text end from memberships m join profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id where m.workspace_id=w; end $$;
create function public.revoke_invitation(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
 update invitations set revoked_at=now() where id=p_id and workspace_id=w and accepted_at is null; end $$;

create function public.register_document(w uuid,p_id uuid,p_name text,p_mime text,p_size integer,p_pages integer,p_hash text,p_kind text,p_product uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare d documents; begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_product is not null and not exists(select 1 from products where id=p_product and workspace_id=w) then raise exception 'Product not found' using errcode='42501'; end if;
 insert into documents(id,workspace_id,name,mime,size_bytes,page_count,sha256,storage_path,kind,status,uploaded_by)
 values(p_id,w,p_name,p_mime,p_size,p_pages,p_hash,w::text||'/'||p_id::text,p_kind,'uploading',auth.uid()) on conflict(workspace_id,sha256) do nothing returning * into d;
 if d.id is null then select * into d from documents where workspace_id=w and sha256=p_hash; return jsonb_build_object('document',to_jsonb(d),'duplicate',true); end if;
 if p_product is not null then insert into document_links(workspace_id,document_id,product_id) values(w,d.id,p_product); end if;
 return jsonb_build_object('document',to_jsonb(d),'duplicate',false); end $$;
create function public.finish_upload(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 if not exists(select 1 from storage.objects o join documents d on d.storage_path=o.name where d.id=p_id and d.workspace_id=w and o.bucket_id='documents') then raise exception 'File was not stored'; end if;
 update documents set upload_complete=true,status='queued',error_code=null where id=p_id and workspace_id=w and status in ('uploading','failed'); end $$;
create function public.retry_document(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 update documents set status='queued',error_code=null,processing_started_at=null where id=p_id and workspace_id=w and upload_complete and status in ('failed','needs_review') and accepted_product_ids is null; end $$;
create function public.mark_document_deleting(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 update documents set status='deleting' where id=p_id and workspace_id=w;
 delete from document_chunks where document_id=p_id and workspace_id=w;
 delete from extraction_runs where document_id=p_id and workspace_id=w; end $$;
create function public.link_document(w uuid,p_document uuid,p_product uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 insert into document_links(workspace_id,document_id,product_id) values(w,p_document,p_product) on conflict do nothing; end $$;

create function public.confirm_extraction(w uuid,p_document uuid,p_review jsonb) returns uuid[] language plpgsql security definer set search_path=public as $$
declare d documents; inv uuid; item jsonb; pid uuid; ids uuid[]='{}'; begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into strict d from documents where id=p_document and workspace_id=w for update;
 if d.accepted_product_ids is not null then return d.accepted_product_ids; end if;
 if not d.upload_complete or d.status not in ('needs_review','failed','queued') or d.kind<>'invoice' then raise exception 'Document cannot be confirmed'; end if;
 if jsonb_typeof(p_review->'items')<>'array' or jsonb_array_length(p_review->'items') not between 1 and 100 then raise exception 'Review must contain 1 to 100 items'; end if;
 insert into invoices(workspace_id,document_id,invoice_number,seller,purchase_date,currency,subtotal,tax,total,confirmed_by)
 values(w,d.id,p_review->>'invoice_number',p_review->>'seller',(p_review->>'purchase_date')::date,p_review->>'currency',(p_review->>'subtotal')::numeric,(p_review->>'tax')::numeric,(p_review->>'total')::numeric,auth.uid()) returning id into inv;
 for item in select value from jsonb_array_elements(p_review->'items') loop
 if coalesce((item->>'quantity')::numeric,0)<=0 then raise exception 'Quantity must be positive'; end if;
 insert into products(workspace_id,name,category,brand,model,serial_number,seller,purchase_date,price,currency)
 values(w,item->>'name',coalesce(item->>'category','Other'),item->>'brand',item->>'model',item->>'serial_number',p_review->>'seller',(p_review->>'purchase_date')::date,(item->>'line_total')::numeric,p_review->>'currency') returning id into pid;
 insert into invoice_items(workspace_id,invoice_id,product_id,description,quantity,unit_price,line_total) values(w,inv,pid,item->>'name',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'line_total')::numeric);
 insert into document_links(workspace_id,document_id,product_id) values(w,d.id,pid); ids=array_append(ids,pid);
 end loop;
 update documents set status='completed',accepted_product_ids=ids,error_code=null where id=d.id;
 update extraction_runs set review=p_review,confirmed_by=auth.uid() where id=(select id from extraction_runs where document_id=d.id order by created_at desc limit 1);
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(w,auth.uid(),'extraction.confirmed',d.id); return ids;
end $$;
create function public.complete_document_review(w uuid,p_document uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 update documents set status='completed' where id=p_document and workspace_id=w and kind<>'invoice' and upload_complete and status in ('needs_review','failed'); end $$;

create function public.add_case_event(w uuid,p_case uuid,p_event jsonb) returns uuid language plpgsql security definer set search_path=public as $$ declare c service_cases; eid uuid; begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into strict c from service_cases where id=p_case and workspace_id=w for update;
 if p_event->>'kind'='status' then update service_cases set status=p_event->>'status' where id=c.id; end if;
 insert into case_events(workspace_id,case_id,kind,note,occurred_on,amount,currency,status,replacement_details,created_by) values(w,c.id,p_event->>'kind',p_event->>'note',(p_event->>'occurred_on')::date,(p_event->>'amount')::numeric,coalesce(p_event->>'currency','INR'),p_event->>'status',p_event->>'replacement_details',auth.uid()) returning id into eid;
 insert into lifecycle_events(workspace_id,product_id,kind,description) values(w,c.product_id,p_event->>'kind',p_event->>'note'); return eid; end $$;

create function public.create_reminder(w uuid,p_product uuid,p_case uuid,p_kind text,p_title text,p_due timestamptz,p_repeat integer default null) returns uuid language plpgsql security definer set search_path=public as $$ declare rid uuid=gen_random_uuid(); begin
 if workspace_role(w) is null or p_kind not in ('maintenance','follow_up') or p_due is null or length(p_title) not between 1 and 200 then raise exception 'Invalid reminder' using errcode='42501'; end if;
 if p_case is not null and not exists(select 1 from service_cases where id=p_case and workspace_id=w and product_id=p_product and status not in ('Resolved','Rejected','Cancelled')) then raise exception 'Case is unavailable'; end if;
 if p_kind='follow_up' and p_case is null then raise exception 'Select a case'; end if;
 insert into reminders(id,workspace_id,user_id,product_id,case_id,kind,title,due_at,source_key,repeat_months) values(rid,w,auth.uid(),p_product,p_case,p_kind,p_title,p_due,'manual-'||rid::text,p_repeat); return rid; end $$;
create function public.cancel_reminder(w uuid,p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 update reminders set status='cancelled' where id=p_id and workspace_id=w and user_id=auth.uid() and workspace_role(w) is not null; end $$;

create function public.match_product_chunks(w uuid,p_product uuid,p_embedding extensions.vector(1536),p_model text,p_limit integer default 8) returns table(id uuid,document_id uuid,page integer,content text,name text,similarity double precision) language sql stable security invoker set search_path=public,extensions as $$
 select c.id,c.document_id,c.page,c.content,d.name,1-(c.embedding <=> p_embedding) as similarity from document_chunks c join documents d on d.id=c.document_id and d.workspace_id=c.workspace_id
 where c.workspace_id=w and workspace_role(w) is not null and d.status<>'deleting' and c.embedding_model=p_model and c.embedding is not null
 and exists(select 1 from document_links l where l.document_id=c.document_id and l.product_id=p_product and l.workspace_id=w)
 order by c.embedding <=> p_embedding limit least(greatest(p_limit,1),12) $$;

create function public.workspace_analytics(w uuid) returns jsonb language plpgsql stable security invoker set search_path=public as $$ begin
 if workspace_role(w) is null then raise exception 'Access denied' using errcode='42501'; end if;
 return jsonb_build_object(
 'products',(select count(*) from products where workspace_id=w and archived_at is null),
 'open_cases',(select count(*) from service_cases where workspace_id=w and status not in ('Resolved','Rejected','Cancelled')),
 'missing_receipts',(select count(*) from products p where p.workspace_id=w and p.archived_at is null and not exists(select 1 from document_links l join documents d on d.id=l.document_id where l.product_id=p.id and d.kind='invoice' and d.status<>'deleting')),
 'unconfirmed_coverage',(select count(*) from coverage where workspace_id=w and not confirmed),
 'expenditure',coalesce((select jsonb_agg(t) from (select currency,sum(price)::text amount from products where workspace_id=w and price is not null group by currency) t),'[]'::jsonb),
 'costs',coalesce((select jsonb_agg(t) from (select currency,kind,sum(amount)::text amount from case_events where workspace_id=w and amount is not null and kind in ('repair','maintenance','refund') group by currency,kind) t),'[]'::jsonb),
 'repeated_issues',coalesce((select jsonb_agg(t) from (select p.id,p.name,count(c.id) count from products p join service_cases c on c.product_id=p.id where p.workspace_id=w group by p.id having count(c.id)>1 order by count(c.id) desc limit 10) t),'[]'::jsonb)); end $$;

-- Privileged worker RPCs; no browser/user grants.
create function public.reserve_ai_usage(w uuid,p_user uuid,p_operation text,p_units integer,p_daily_limit integer) returns void language plpgsql security definer set search_path=public as $$ begin
 perform pg_advisory_xact_lock(hashtext(w::text));
 if p_units<1 or (select coalesce(sum(units),0) from ai_usage where workspace_id=w and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+p_units>p_daily_limit then raise exception 'AI_DAILY_LIMIT'; end if;
 if p_user is not null and not exists(select 1 from memberships where workspace_id=w and user_id=p_user) then raise exception 'Access revoked'; end if;
 insert into ai_usage(workspace_id,user_id,operation,units) values(w,p_user,p_operation,p_units); end $$;
create function public.deliver_reminder(p_id uuid) returns uuid language plpgsql security definer set search_path=public as $$ declare r reminders; p profiles; n uuid; begin
 select * into r from reminders where id=p_id for update;
 if r.id is null or r.status<>'scheduled' or r.due_at>now() then return null; end if;
 select * into p from profiles where id=r.user_id;
 if not p.reminders_enabled or not exists(select 1 from memberships where workspace_id=r.workspace_id and user_id=r.user_id) or exists(select 1 from products where id=r.product_id and archived_at is not null)
 or (r.coverage_id is not null and not exists(select 1 from coverage c where c.id=r.coverage_id and c.confirmed and c.revision::text||'-'||p.revision::text=r.source_revision))
 or (r.case_id is not null and exists(select 1 from service_cases where id=r.case_id and status in ('Resolved','Rejected','Cancelled'))) then update reminders set status='cancelled' where id=r.id; return null; end if;
 insert into notifications(workspace_id,user_id,reminder_id,title) values(r.workspace_id,r.user_id,r.id,r.title) on conflict(reminder_id) do nothing returning id into n;
 insert into deliveries(workspace_id,user_id,reminder_id,channel,state,attempts) values(r.workspace_id,r.user_id,r.id,'in_app','delivered',1) on conflict(reminder_id,channel) do nothing;
 insert into deliveries(workspace_id,user_id,reminder_id,channel,state) values(r.workspace_id,r.user_id,r.id,'email',case when p.email_enabled then 'pending' else 'disabled' end) on conflict(reminder_id,channel) do nothing;
 update reminders set status='delivered' where id=r.id; return n; end $$;
create function public.save_assistant_exchange(w uuid,p_user uuid,p_product uuid,p_question text,p_answer text,p_sources jsonb) returns uuid language plpgsql security definer set search_path=public as $$ declare c uuid; source jsonb; begin
 if not exists(select 1 from memberships where workspace_id=w and user_id=p_user) or not exists(select 1 from products where id=p_product and workspace_id=w) then raise exception 'Access revoked'; end if;
 for source in select value from jsonb_array_elements(p_sources) loop
  perform 1 from document_chunks ch join documents d on d.id=ch.document_id and d.workspace_id=ch.workspace_id join document_links l on l.document_id=d.id and l.workspace_id=d.workspace_id
  where ch.id=(source->>'id')::uuid and d.id=(source->>'document_id')::uuid and ch.page=(source->>'page')::integer and ch.workspace_id=w and l.product_id=p_product and d.status<>'deleting' for share of d;
  if not found then raise exception 'Source is no longer available' using errcode='42501'; end if;
 end loop;
 insert into conversations(workspace_id,product_id,user_id) values(w,p_product,p_user) on conflict(product_id,user_id) do update set product_id=excluded.product_id returning id into c;
 insert into messages(workspace_id,conversation_id,role,content) values(w,c,'user',p_question);
 insert into messages(workspace_id,conversation_id,role,content,sources) values(w,c,'assistant',p_answer,p_sources); return c; end $$;

-- Limit grants to AfterBuy functions; leave other applications and extensions untouched.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['workspace_role','can_edit','immutable_scope','provision_profile','product_history','coverage_dates','refresh_product_coverage','profile_revision','case_transition','case_history','create_workspace','create_invitation','accept_invitation','manage_member','list_members','revoke_invitation','register_document','finish_upload','retry_document','mark_document_deleting','link_document','confirm_extraction','complete_document_review','add_case_event','create_reminder','cancel_reminder','match_product_chunks','workspace_analytics','reserve_ai_usage','deliver_reminder','save_assistant_exchange']) loop
 execute format('revoke execute on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop; end $$;
grant execute on function public.workspace_role(uuid),public.can_edit(uuid) to authenticated;
grant execute on function public.create_workspace(text,text),public.create_invitation(uuid,text,text),public.accept_invitation(text),public.manage_member(uuid,uuid,text),public.list_members(uuid),public.revoke_invitation(uuid,uuid) to authenticated;
grant execute on function public.register_document(uuid,uuid,text,text,integer,integer,text,text,uuid),public.finish_upload(uuid,uuid),public.retry_document(uuid,uuid),public.mark_document_deleting(uuid,uuid),public.link_document(uuid,uuid,uuid),public.confirm_extraction(uuid,uuid,jsonb),public.complete_document_review(uuid,uuid),public.add_case_event(uuid,uuid,jsonb) to authenticated;
grant execute on function public.create_reminder(uuid,uuid,uuid,text,text,timestamptz,integer),public.cancel_reminder(uuid,uuid),public.match_product_chunks(uuid,uuid,extensions.vector,text,integer),public.workspace_analytics(uuid) to authenticated;
