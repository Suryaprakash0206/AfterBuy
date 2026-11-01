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
