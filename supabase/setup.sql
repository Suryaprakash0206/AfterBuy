-- AfterBuy: initial database setup, generated from 8 migrations.
-- Paste this entire file into your Supabase project's SQL Editor and Run.
-- For a fresh AfterBuy installation only. Existing Auth accounts are preserved.
-- All changes commit together; an error rolls the setup back.
begin;
do $$ begin
 if to_regclass('public.workspaces') is not null then
  raise exception 'Workspace tables already exist. Apply only pending migrations instead of running initial setup again.';
 end if;
end $$;
-- Migration: 202610210001_schema.sql
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
set search_path = public, extensions;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', currency text not null default 'INR' check(currency ~ '^[A-Z]{3}$'),
 timezone text not null default 'Asia/Kolkata', reminder_days integer[] not null default '{30,7,1}',
 reminders_enabled boolean not null default true, email_enabled boolean not null default false,
 revision integer not null default 1, created_at timestamptz not null default now()
);
create table public.workspaces(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),kind text not null check(kind in ('personal','household')),created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create unique index one_personal_workspace on public.workspaces(created_by) where kind='personal';
create table public.memberships(workspace_id uuid not null references public.workspaces on delete cascade,user_id uuid not null references auth.users on delete cascade,role text not null check(role in ('owner','editor','viewer')),created_at timestamptz not null default now(),primary key(workspace_id,user_id));
create index memberships_user on public.memberships(user_id);
create function public.workspace_role(w uuid) returns text language sql stable security definer set search_path=public as $$ select role from memberships where workspace_id=w and user_id=auth.uid() $$;
create function public.can_edit(w uuid) returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.workspace_role(w) in ('owner','editor'),false) $$;
create table public.invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,email text not null,role text not null check(role in ('editor','viewer')),token_hash text not null unique,expires_at timestamptz not null,accepted_at timestamptz,revoked_at timestamptz,created_by uuid not null references auth.users,created_at timestamptz not null default now());
create table public.products (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
 name text not null check(length(name) between 1 and 160),category text not null default 'Other',brand text,model text,serial_number text,seller text,
 purchase_date date,delivery_date date,price numeric(16,4) check(price>=0),currency text not null check(currency ~ '^[A-Z]{3}$'),location text,notes text,
 archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,workspace_id)
);
create index products_workspace on public.products(workspace_id,created_at desc);
create index products_search on public.products using gin(to_tsvector('simple',name || ' ' || coalesce(brand,'') || ' ' || coalesce(model,'')));
create table public.documents (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
 name text not null,mime text not null check(mime in ('application/pdf','image/jpeg','image/png')),size_bytes integer not null check(size_bytes between 1 and 20971520),page_count integer not null check(page_count between 1 and 40),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),storage_path text not null unique,kind text not null check(kind in ('invoice','warranty','manual','service','photo','other')),
 status text not null default 'queued' check(status in ('uploading','queued','processing','needs_review','completed','failed','deleting')),
 uploaded_by uuid not null references auth.users,upload_complete boolean not null default false,error_code text,processing_started_at timestamptz,
 index_status text not null default 'pending' check(index_status in ('pending','processing','ready','failed','unavailable')),
 accepted_product_ids uuid[],created_at timestamptz not null default now(),unique(id,workspace_id),unique(workspace_id,sha256)
);
create table public.document_links(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,document_id uuid not null,product_id uuid not null,created_at timestamptz not null default now(),foreign key(document_id,workspace_id) references public.documents(id,workspace_id) on delete cascade,foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade,unique(document_id,product_id));
create table public.invoices(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,document_id uuid,invoice_number text,seller text,purchase_date date,currency text not null check(currency ~ '^[A-Z]{3}$'),subtotal numeric(16,4),tax numeric(16,4),total numeric(16,4),confirmed_by uuid not null references auth.users,created_at timestamptz not null default now(),unique(id,workspace_id),unique(document_id),foreign key(document_id,workspace_id) references public.documents(id,workspace_id) on delete set null(document_id));
create table public.invoice_items(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,invoice_id uuid not null,product_id uuid,description text not null,quantity numeric(12,4) not null check(quantity>0),unit_price numeric(16,4),line_total numeric(16,4),foreign key(invoice_id,workspace_id) references public.invoices(id,workspace_id) on delete cascade,foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete set null(product_id));
create table public.extraction_runs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,document_id uuid not null,attempt integer not null default 1,provider text not null default 'openai',model text,status text not null check(status in ('processing','succeeded','failed')),result jsonb,review jsonb,error_code text,confirmed_by uuid references auth.users,created_at timestamptz not null default now(),foreign key(document_id,workspace_id) references public.documents(id,workspace_id) on delete cascade);
create index extraction_document on public.extraction_runs(document_id,created_at desc);
create table public.coverage (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,product_id uuid not null,kind text not null check(kind in ('return','manufacturer','extended','repair')),provider text not null,source_document_id uuid,components text,
 basis text not null check(basis in ('purchase','delivery','explicit')),explicit_start date,duration_months integer check(duration_months between 0 and 600),duration_days integer check(duration_days between 0 and 36600),explicit_end date,
 start_date date,end_date date,exclusions text,conditions text,uncertainty text,confirmed boolean not null default false,revision integer not null default 1,created_at timestamptz not null default now(),unique(id,workspace_id),
 foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade,foreign key(source_document_id,workspace_id) references public.documents(id,workspace_id) on delete set null(source_document_id),check(duration_months is null or duration_days is null),check(end_date is null or start_date is null or end_date>=start_date),check(not confirmed or (start_date is not null and end_date is not null))
);
create index coverage_deadlines on public.coverage(workspace_id,end_date) where confirmed;
create table public.service_cases(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,product_id uuid not null,title text not null,description text not null,occurred_on date not null,status text not null default 'Draft' check(status in ('Draft','Submitted','Awaiting response','Inspection','Resolved','Rejected','Cancelled')),support_contact text,reference text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,workspace_id),foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade);
create table public.case_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,case_id uuid not null,kind text not null check(kind in ('note','troubleshooting','repair','replacement','refund','maintenance','status')),note text not null,occurred_on date not null,amount numeric(16,4) check(amount>=0),currency text not null check(currency ~ '^[A-Z]{3}$'),status text,replacement_details text,created_by uuid default auth.uid() references auth.users,created_at timestamptz not null default now(),foreign key(case_id,workspace_id) references public.service_cases(id,workspace_id) on delete cascade);
create table public.lifecycle_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,product_id uuid not null,kind text not null,description text not null,occurred_at timestamptz not null default now(),actor_id uuid default auth.uid() references auth.users,foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade);
create table public.reminders(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null references auth.users on delete cascade,product_id uuid,coverage_id uuid,case_id uuid,kind text not null check(kind in ('coverage','follow_up','maintenance')),title text not null,due_at timestamptz not null,source_key text not null unique,source_revision text,status text not null default 'scheduled' check(status in ('scheduled','delivered','cancelled')),repeat_months integer check(repeat_months between 1 and 120),created_at timestamptz not null default now(),unique(id,workspace_id),foreign key(workspace_id,user_id) references public.memberships(workspace_id,user_id) on delete cascade,foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade,foreign key(coverage_id,workspace_id) references public.coverage(id,workspace_id) on delete cascade,foreign key(case_id,workspace_id) references public.service_cases(id,workspace_id) on delete cascade);
create index reminders_due on public.reminders(due_at) where status='scheduled';
create table public.notifications(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null references auth.users on delete cascade,reminder_id uuid not null unique,title text not null,read_at timestamptz,snoozed_until timestamptz,created_at timestamptz not null default now(),unique(id,workspace_id),foreign key(reminder_id,workspace_id) references public.reminders(id,workspace_id) on delete cascade);
create table public.deliveries(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,reminder_id uuid not null,user_id uuid not null references auth.users,channel text not null check(channel in ('in_app','email')),state text not null check(state in ('pending','delivered','accepted','failed','disabled')),provider_id text,error_code text,attempts integer not null default 0,updated_at timestamptz not null default now(),unique(reminder_id,channel),foreign key(reminder_id,workspace_id) references public.reminders(id,workspace_id) on delete cascade);
create table public.conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,product_id uuid not null,user_id uuid not null default auth.uid() references auth.users on delete cascade,created_at timestamptz not null default now(),unique(id,workspace_id),unique(product_id,user_id),foreign key(product_id,workspace_id) references public.products(id,workspace_id) on delete cascade);
create table public.messages(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,conversation_id uuid not null,role text not null check(role in ('user','assistant')),content text not null,sources jsonb not null default '[]',created_at timestamptz not null default now(),foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id) on delete cascade);
create table public.document_chunks(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,document_id uuid not null,page integer not null check(page>0),ordinal integer not null,content text not null,embedding extensions.vector(1536),embedding_model text,created_at timestamptz not null default now(),foreign key(document_id,workspace_id) references public.documents(id,workspace_id) on delete cascade,unique(document_id,ordinal));
create index chunks_vector on public.document_chunks using hnsw(embedding extensions.vector_cosine_ops);
create table public.audit_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,actor_id uuid references auth.users,action text not null,resource_id uuid,created_at timestamptz not null default now());
create table public.ai_usage(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,user_id uuid references auth.users,operation text not null,units integer not null,created_at timestamptz not null default now());
create index ai_usage_day on public.ai_usage(workspace_id,created_at);

-- Deny by default. Only explicitly granted operations are exposed.
do $$ declare t text; begin
 foreach t in array array['profiles','workspaces','memberships','invitations','products','documents','document_links','invoices','invoice_items','extraction_runs','coverage','service_cases','case_events','lifecycle_events','reminders','notifications','deliveries','conversations','messages','document_chunks','audit_events','ai_usage'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['workspaces','memberships','products','documents','document_links','invoices','invoice_items','extraction_runs','coverage','service_cases','case_events','lifecycle_events','document_chunks'] loop
 if t='workspaces' then execute 'create policy member_read on public.workspaces for select to authenticated using(public.workspace_role(id) is not null)';
 else execute format('create policy member_read on public.%I for select to authenticated using(public.workspace_role(workspace_id) is not null)',t); end if;
 execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['products','coverage','service_cases'] loop
 execute format('create policy editor_insert on public.%I for insert to authenticated with check(public.can_edit(workspace_id))',t);
 execute format('create policy editor_update on public.%I for update to authenticated using(public.can_edit(workspace_id)) with check(public.can_edit(workspace_id))',t);
 execute format('create policy editor_delete on public.%I for delete to authenticated using(public.can_edit(workspace_id))',t);
 execute format('grant insert, update, delete on public.%I to authenticated',t);
 end loop;
end $$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy update_profile on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select on public.profiles to authenticated;
grant update(display_name,currency,timezone,reminder_days,reminders_enabled,email_enabled) on public.profiles to authenticated;
create policy owner_invites on public.invitations for select to authenticated using(public.workspace_role(workspace_id)='owner');
grant select(id,workspace_id,email,role,expires_at,accepted_at,revoked_at,created_at) on public.invitations to authenticated;
create policy own_reminders on public.reminders for select to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null);
create policy own_notifications on public.notifications for select to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null);
create policy update_notifications on public.notifications for update to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null) with check(user_id=auth.uid());
grant select on public.reminders,public.notifications to authenticated;
grant update(read_at,snoozed_until) on public.notifications to authenticated;
create policy own_deliveries on public.deliveries for select to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null);
grant select on public.deliveries to authenticated;
create policy own_conversations on public.conversations for all to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null) with check(user_id=auth.uid() and public.workspace_role(workspace_id) is not null);
grant select,insert on public.conversations to authenticated;
create policy own_messages on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and c.user_id=auth.uid() and public.workspace_role(c.workspace_id) is not null));
grant select on public.messages to authenticated;
create policy owner_audit on public.audit_events for select to authenticated using(public.workspace_role(workspace_id)='owner');
grant select on public.audit_events to authenticated;

-- IDs and workspace ownership are immutable, including for direct PostgREST requests.
create function public.immutable_scope() returns trigger language plpgsql as $$ begin
 if new.id<>old.id or new.workspace_id<>old.workspace_id then raise exception 'Scope is immutable' using errcode='42501'; end if; return new; end $$;
do $$ declare t text; begin foreach t in array array['products','coverage','service_cases','notifications'] loop execute format('create trigger immutable_scope before update on public.%I for each row execute function public.immutable_scope()',t); end loop; end $$;

create function public.provision_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')) on conflict do nothing; return new; end $$;
create trigger provision_profile after insert on auth.users for each row execute function public.provision_profile();

create function public.product_history() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if tg_op='INSERT' then insert into lifecycle_events(workspace_id,product_id,kind,description) values(new.workspace_id,new.id,'purchase','Purchase recorded');
 else new.updated_at=now(); insert into lifecycle_events(workspace_id,product_id,kind,description) values(new.workspace_id,new.id,case when new.archived_at is distinct from old.archived_at then 'archive' else 'updated' end,case when new.archived_at is distinct from old.archived_at then 'Archive status changed' else 'Product details updated' end); end if;
 return new; end $$;
create trigger product_history after insert or update on public.products for each row execute function public.product_history();

create function public.coverage_dates() returns trigger language plpgsql security definer set search_path=public as $$ declare p products; begin
 select * into strict p from products where id=new.product_id and workspace_id=new.workspace_id;
 new.start_date=case new.basis when 'purchase' then p.purchase_date when 'delivery' then p.delivery_date else new.explicit_start end;
 new.end_date=coalesce(new.explicit_end,case when new.duration_months is not null then (new.start_date+make_interval(months=>new.duration_months))::date when new.duration_days is not null then new.start_date+new.duration_days end);
 if tg_op='UPDATE' then new.revision=old.revision+1; update reminders set status='cancelled' where coverage_id=old.id and status='scheduled'; end if;
 if new.source_document_id is not null and not exists(select 1 from document_links where document_id=new.source_document_id and product_id=new.product_id and workspace_id=new.workspace_id) then raise exception 'Coverage source must be linked to the product'; end if;
 return new; end $$;
create trigger coverage_dates before insert or update on public.coverage for each row execute function public.coverage_dates();
create function public.refresh_product_coverage() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if new.purchase_date is distinct from old.purchase_date or new.delivery_date is distinct from old.delivery_date then update coverage set confirmed=case when (basis='purchase' and new.purchase_date is null) or (basis='delivery' and new.delivery_date is null) then false else confirmed end where product_id=new.id; end if;
 if new.archived_at is not null then update reminders set status='cancelled' where product_id=new.id and status='scheduled'; end if; return new; end $$;
create trigger refresh_product_coverage after update on public.products for each row execute function public.refresh_product_coverage();
create function public.profile_revision() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) or cardinality(new.reminder_days)>8 or exists(select 1 from unnest(new.reminder_days) x where x<0 or x>365) then raise exception 'Invalid reminder preferences'; end if;
 new.revision=old.revision+1; update reminders set status='cancelled' where user_id=new.id and kind='coverage' and status='scheduled'; return new; end $$;
create trigger profile_revision before update on public.profiles for each row execute function public.profile_revision();

create function public.case_transition() returns trigger language plpgsql as $$ begin
 if new.product_id<>old.product_id then raise exception 'Case product is immutable'; end if;
 if new.status<>old.status and not (case old.status when 'Draft' then new.status in ('Submitted','Cancelled') when 'Submitted' then new.status in ('Awaiting response','Inspection','Resolved','Rejected','Cancelled') when 'Awaiting response' then new.status in ('Submitted','Inspection','Resolved','Rejected','Cancelled') when 'Inspection' then new.status in ('Awaiting response','Resolved','Rejected','Cancelled') when 'Rejected' then new.status in ('Submitted','Cancelled') else false end) then raise exception 'Invalid case transition'; end if;
 new.updated_at=now(); return new; end $$;
create trigger case_transition before update on public.service_cases for each row execute function public.case_transition();
create function public.case_history() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if tg_op='INSERT' or new.status is distinct from old.status then
 insert into lifecycle_events(workspace_id,product_id,kind,description) values(new.workspace_id,new.product_id,'case',new.title || ': ' || new.status);
 if new.status in ('Resolved','Rejected','Cancelled') then update reminders set status='cancelled' where case_id=new.id and status='scheduled'; end if;
 end if; return new; end $$;
create trigger case_history after insert or update on public.service_cases for each row execute function public.case_history();


-- Migration: 202610210002_operations.sql
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


-- Migration: 202610210003_storage.sql
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('documents','documents',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy documents_read on storage.objects for select to authenticated using(bucket_id='documents' and exists(select 1 from public.documents d where d.storage_path=storage.objects.name and d.status<>'deleting' and public.workspace_role(d.workspace_id) is not null));
create policy documents_upload on storage.objects for insert to authenticated with check(bucket_id='documents' and exists(select 1 from public.documents d where d.storage_path=storage.objects.name and d.status='uploading' and d.uploaded_by=auth.uid() and public.can_edit(d.workspace_id)));
-- Deletion is an outbox operation handled by the worker. No direct browser deletes or overwrites.


-- Migration: 202610210004_reliability.sql
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


-- Migration: 202610210005_job_guards.sql
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


-- Migration: 202610210006_existing_accounts.sql
-- Support installing AfterBuy after accounts already exist in Supabase Auth.
insert into public.profiles(id,display_name)
select id,coalesce(raw_user_meta_data->>'display_name','') from auth.users
on conflict(id) do nothing;

-- Invoice accounting is exact and non-negative even through direct RPC calls.
alter table public.invoices add constraint invoice_nonnegative check((subtotal is null or subtotal>=0) and (tax is null or tax>=0) and (total is null or total>=0));
alter table public.invoice_items add constraint item_nonnegative check((unit_price is null or unit_price>=0) and (line_total is null or line_total>=0));


-- Migration: 202610230001_optional_email_confirmation.sql
-- Email confirmation is optional. Authentication and intended-account invitation
-- matching remain required. Hosted Auth's "Confirm email" setting is managed
-- separately in the Supabase dashboard; SQL cannot switch that service setting.
create or replace function public.create_workspace(p_name text,p_kind text default 'personal') returns uuid language plpgsql security definer set search_path=public as $$ declare w uuid; begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then raise exception 'Sign in first' using errcode='42501'; end if;
 if p_kind not in ('personal','household') then raise exception 'Invalid workspace type'; end if;
 if p_kind='personal' then select id into w from workspaces where created_by=auth.uid() and kind='personal'; if w is not null then return w; end if; end if;
 insert into workspaces(name,kind,created_by) values(p_name,p_kind,auth.uid()) returning id into w;
 insert into memberships values(w,auth.uid(),'owner',now());
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(w,auth.uid(),'workspace.created',w); return w; end $$;

create or replace function public.accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path=public,extensions as $$ declare i invitations; e text; begin
 select lower(email) into e from auth.users where id=auth.uid();
 if e is null then raise exception 'Sign in with an email account first' using errcode='42501'; end if;
 select * into i from invitations where token_hash=encode(digest(p_token,'sha256'),'hex') for update;
 if i.id is null or i.accepted_at is not null or i.revoked_at is not null or i.expires_at<=now() or i.email<>e then raise exception 'Invitation is invalid, expired, or belongs to another account' using errcode='42501'; end if;
 perform create_workspace('My personal workspace','personal');
 insert into memberships(workspace_id,user_id,role) values(i.workspace_id,auth.uid(),i.role) on conflict(workspace_id,user_id) do nothing;
 update invitations set accepted_at=now() where id=i.id;
 insert into audit_events(workspace_id,actor_id,action) values(i.workspace_id,auth.uid(),'invitation.accepted'); return i.workspace_id; end $$;

revoke execute on function public.create_workspace(text,text),public.accept_invitation(text) from public,anon;
grant execute on function public.create_workspace(text,text),public.accept_invitation(text) to authenticated,service_role;


-- Migration: 202610250001_invoice_product_warranties.sql
-- Apply once to existing installations before running the updated app.
alter table public.products add column specifications text check(length(specifications)<=5000);

create or replace function public.confirm_extraction(w uuid,p_document uuid,p_review jsonb) returns uuid[] language plpgsql security definer set search_path=public as $$
declare d documents; inv uuid; item jsonb; pid uuid; warranty jsonb; item_index integer=0; ids uuid[]='{}'; begin
 if not can_edit(w) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into strict d from documents where id=p_document and workspace_id=w for update;
 if d.accepted_product_ids is not null then return d.accepted_product_ids; end if;
 if not d.upload_complete or d.status not in ('needs_review','failed','queued') or d.kind<>'invoice' then raise exception 'Document cannot be confirmed'; end if;
 if coalesce(jsonb_typeof(p_review->'items'),'null')<>'array' or jsonb_array_length(p_review->'items') not between 1 and 100 then raise exception 'Review must contain 1 to 100 items'; end if;
 if jsonb_typeof(coalesce(p_review->'warranties','[]'::jsonb))<>'array' then raise exception 'Warranties must be an array'; end if;
 if jsonb_array_length(coalesce(p_review->'warranties','[]'::jsonb))>200 then raise exception 'Too many warranties'; end if;
 for warranty in select value from jsonb_array_elements(coalesce(p_review->'warranties','[]'::jsonb)) loop
   if warranty->>'item_index' is null or (warranty->>'item_index') !~ '^[0-9]+$' or (warranty->>'item_index')::integer >= jsonb_array_length(p_review->'items') then raise exception 'Choose a valid warranty product'; end if;
   if coalesce((warranty->>'confirmed')::boolean,false) and nullif(trim(warranty->>'provider'),'') is null then raise exception 'Confirmed coverage needs a provider'; end if;
 end loop;
 insert into invoices(workspace_id,document_id,invoice_number,seller,purchase_date,currency,subtotal,tax,total,confirmed_by)
 values(w,d.id,p_review->>'invoice_number',p_review->>'seller',(p_review->>'purchase_date')::date,p_review->>'currency',(p_review->>'subtotal')::numeric,(p_review->>'tax')::numeric,(p_review->>'total')::numeric,auth.uid()) returning id into inv;
 for item in select value from jsonb_array_elements(p_review->'items') loop
 if coalesce((item->>'quantity')::numeric,0)<=0 then raise exception 'Quantity must be positive'; end if;
 insert into products(workspace_id,name,category,brand,model,serial_number,specifications,seller,purchase_date,price,currency)
 values(w,item->>'name',coalesce(item->>'category','Other'),item->>'brand',item->>'model',item->>'serial_number',item->>'specifications',p_review->>'seller',(p_review->>'purchase_date')::date,(item->>'line_total')::numeric,p_review->>'currency') returning id into pid;
 insert into invoice_items(workspace_id,invoice_id,product_id,description,quantity,unit_price,line_total) values(w,inv,pid,item->>'name',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'line_total')::numeric);
 insert into document_links(workspace_id,document_id,product_id) values(w,d.id,pid); ids=array_append(ids,pid);
 for warranty in select value from jsonb_array_elements(coalesce(p_review->'warranties','[]'::jsonb)) where (value->>'item_index')::integer=item_index loop
   insert into coverage(workspace_id,product_id,source_document_id,kind,provider,basis,explicit_start,explicit_end,duration_months,duration_days,conditions,exclusions,uncertainty,confirmed)
   values(w,pid,d.id,warranty->>'kind',coalesce(warranty->>'provider',''),warranty->>'basis',nullif(warranty->>'explicit_start','')::date,nullif(warranty->>'explicit_end','')::date,nullif(warranty->>'duration_months','')::integer,nullif(warranty->>'duration_days','')::integer,warranty->>'conditions',warranty->>'exclusions',warranty->>'uncertainty',coalesce((warranty->>'confirmed')::boolean,false));
 end loop;
 item_index=item_index+1;
 end loop;
 update documents set status='completed',accepted_product_ids=ids,error_code=null where id=d.id;
 update extraction_runs set review=p_review,confirmed_by=auth.uid() where id=(select id from extraction_runs where document_id=d.id order by created_at desc limit 1);
 insert into audit_events(workspace_id,actor_id,action,resource_id) values(w,auth.uid(),'extraction.confirmed',d.id); return ids;
end $$;

-- A distinct entry point prevents an older installed RPC silently discarding the new fields.
create function public.confirm_invoice_details(w uuid,p_document uuid,p_review jsonb)
returns uuid[] language sql security invoker set search_path=public as $$
  select public.confirm_extraction(w,p_document,p_review);
$$;
revoke all on function public.confirm_invoice_details(uuid,uuid,jsonb) from public,anon;
grant execute on function public.confirm_invoice_details(uuid,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
commit;
