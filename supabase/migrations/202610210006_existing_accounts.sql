-- Support installing AfterBuy after accounts already exist in Supabase Auth.
insert into public.profiles(id,display_name)
select id,coalesce(raw_user_meta_data->>'display_name','') from auth.users
on conflict(id) do nothing;

-- Invoice accounting is exact and non-negative even through direct RPC calls.
alter table public.invoices add constraint invoice_nonnegative check((subtotal is null or subtotal>=0) and (tax is null or tax>=0) and (total is null or total>=0));
alter table public.invoice_items add constraint item_nonnegative check((unit_price is null or unit_price>=0) and (line_total is null or line_total>=0));
