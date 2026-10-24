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
