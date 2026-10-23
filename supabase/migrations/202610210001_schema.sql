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
