import {Router} from 'express';
import {coverageSchema,coverageDates,idSchema} from '../../../../shared/domain.js';
import {result} from '../../lib/db.js';
import {getProduct} from '../products/repository.js';
import {editAccess} from '../../lib/auth.js';
import {AppError} from '../../lib/errors.js';
export const coverageRoutes=Router({mergeParams:true});
coverageRoutes.get('/coverage',async(req,res)=>res.json(await result(req.db.from('coverage').select('*,product:products(id,name,archived_at)').eq('workspace_id',req.workspaceId).order('end_date').limit(1000))));
for(const method of ['post','patch'] as const)coverageRoutes[method](method==='post'?'/coverage':'/coverage/:id',editAccess,async(req,res)=>{
 const b=coverageSchema.parse(req.body);const product=await getProduct(req.db,req.workspaceId,b.product_id);let dates;try{dates=coverageDates(b,product);}catch{throw new AppError(400,'INVALID_DATES','Coverage cannot end before its start date.');}
 if(b.confirmed&&(!dates.start_date||!dates.end_date))throw new AppError(400,'MISSING_DATES','Confirmed coverage needs a known start and end date.');
 const query=method==='post'?req.db.from('coverage').insert({...b,workspace_id:req.workspaceId}):req.db.from('coverage').update(b).eq('workspace_id',req.workspaceId).eq('id',idSchema.parse(req.params.id));res.status(method==='post'?201:200).json(await result(query.select().single()));
});
coverageRoutes.delete('/coverage/:id',editAccess,async(req,res)=>{await result(req.db.from('coverage').delete().eq('workspace_id',req.workspaceId).eq('id',idSchema.parse(req.params.id)));res.json({ok:true});});
