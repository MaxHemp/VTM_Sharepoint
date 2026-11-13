#!/usr/bin/env node
/** One bounded durable tick. Installation/activation remains a separate approved operation. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CustomerWorkflow } from '../lib/customer-workflow.ts';
import { createDeliveryAdapter, createSqliteDeliveryStore } from '../lib/customer-delivery.ts';

const args=new Set(process.argv.slice(2));
if([...args].some(a=>!['--once','--deliver','--reconcile'].includes(a)))throw new Error('Usage: node --experimental-transform-types scripts/customer-workflow-worker.mjs --once [--deliver] [--reconcile]');
if(!args.has('--once'))throw new Error('Explicit --once required. Configure the existing host scheduler separately.');
const filename=path.resolve('data','vtm.db');
if(!fs.existsSync(filename))throw new Error('Existing portal database not found. Refusing to create a separate empty production database.');
const db=new Database(filename);
db.pragma('journal_mode = WAL');
const workflow=new CustomerWorkflow(db);
const enabled=process.env.CUSTOMER_DELIVERY_ENABLED==='true';
const adapter=createDeliveryAdapter({enabled,store:createSqliteDeliveryStore(db),beforeMutation:request=>workflow.assertDispatchAllowed(request)});
let failed=false;
try {
  const maintenance=workflow.maintenance();
  await workflow.synchronizeAdjudications(adapter);
  // Only non-sensitive counters/state enter stdout. No content, addresses, keys or raw errors.
  const delivery=args.has('--deliver')?await workflow.dispatchOne(adapter,enabled):{state:'not_requested'};
  const reconciliation=args.has('--reconcile')&&enabled?await workflow.reconcileOne(adapter):{state:'not_requested'};
  console.log(JSON.stringify({maintenance,delivery,reconciliation,liveEnabled:enabled}));
} catch(error) {
  failed=true;
  console.error(JSON.stringify({state:'blocked',code:typeof error?.code==='string'?error.code:'INTERNAL',message:'Workflow tick failed. Inspect the authenticated portal; do not blindly resend.'}));
} finally { db.close(); }
if(failed)process.exitCode=1;
