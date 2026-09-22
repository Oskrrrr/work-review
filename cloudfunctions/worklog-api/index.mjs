import crypto from 'node:crypto';

let app;
let db;
let rdb;
let cloudbaseModule;
let importerModule;

const DOCUMENT_TABLE = 'worklog_documents';
const withoutUndefined = value => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)]));
  return value;
};
const documentError = result => {
  if (result?.error) throw new Error(result.error.message || String(result.error));
  return result;
};
function createDocumentCompat(database) {
  const rowId = (collection, id) => `${collection}:${id}`;
  const docId = (collection, id) => id.slice(collection.length + 1);
  const readRows = async collection => {
    const result = documentError(await database.from(DOCUMENT_TABLE).select().eq('collection', collection));
    return (result.data || []).map(row => ({...row.data, _id: docId(collection, row.id)}));
  };
  const save = async (collection, id, data, merge = false) => {
    const key = rowId(collection, id);
    const current = documentError(await database.from(DOCUMENT_TABLE).select().eq('id', key));
    const previous = current.data?.[0];
    const nextData = withoutUndefined(merge ? {...(previous?.data || {}), ...data} : data);
    if (previous) {
      documentError(await database.from(DOCUMENT_TABLE).update({data: nextData, updated_at: new Date()}).eq('id', key));
    } else {
      documentError(await database.from(DOCUMENT_TABLE).insert({id: key, collection, data: nextData, created_at: new Date(), updated_at: new Date()}));
    }
    return {...nextData, _id: id};
  };
  const remove = async (collection, id) => {
    documentError(await database.from(DOCUMENT_TABLE).delete().eq('id', rowId(collection, id)));
  };
  class Query {
    constructor(collection, filter = {}) { this.collectionName = collection; this.filter = filter; this.max = null; this.sortField = null; this.sortDirection = 'asc'; }
    where(filter) { this.filter = {...this.filter, ...filter}; return this; }
    limit(value) { this.max = value; return this; }
    orderBy(field, direction = 'asc') { this.sortField = field; this.sortDirection = direction === 'desc' ? 'desc' : 'asc'; return this; }
    async matching() {
      let rows = await readRows(this.collectionName);
      rows = rows.filter(row => Object.entries(this.filter).every(([key, expected]) => row[key] === expected));
      if (this.sortField) rows.sort((left, right) => {
        const a = left[this.sortField] ?? '';
        const b = right[this.sortField] ?? '';
        const result = a < b ? -1 : a > b ? 1 : 0;
        return this.sortDirection === 'desc' ? -result : result;
      });
      return this.max == null ? rows : rows.slice(0, this.max);
    }
    async get() { return {data: await this.matching()}; }
    async update(patch) { await Promise.all((await this.matching()).map(row => save(this.collectionName, row._id, patch, true))); return {data: null}; }
    async remove() { await Promise.all((await this.matching()).map(row => remove(this.collectionName, row._id))); return {data: null}; }
  }
  class Collection {
    constructor(name) { this.name = name; }
    doc(id) {
      const documentId = String(id);
      return {
        async get() { const result = await new Query(this.name).get(); return result; },
        async set(data) { return save(this.name, documentId, data, false); },
        async update(data) { return save(this.name, documentId, data, true); },
        async remove() { return remove(this.name, documentId); },
      };
    }
    where(filter) { return new Query(this.name, filter); }
    async add(data) { const id = crypto.randomUUID(); await save(this.name, id, data, false); return {_id: id}; }
  }
  // Fix the method receiver used by doc().get() without exposing the storage row shape.
  const collection = name => {
    const base = new Collection(name);
    const originalDoc = base.doc.bind(base);
    base.doc = id => {
      const documentId = String(id);
      return {
        async get() {
          const result = documentError(await database.from(DOCUMENT_TABLE).select().eq('id', rowId(name, documentId)));
          const row = result.data?.[0];
          return {data: row ? {...row.data, _id: documentId} : null};
        },
        async set(data) { return save(name, documentId, data, false); },
        async update(data) { return save(name, documentId, data, true); },
        async remove() { return remove(name, documentId); },
      };
    };
    return base;
  };
  return {collection};
}
async function ensureCloud() {
  if (!db) {
    cloudbaseModule ??= await import('@cloudbase/node-sdk');
    const cloudbase = cloudbaseModule.default;
    app = cloudbase.init({env:process.env.CLOUDBASE_ENV_ID||cloudbase.SYMBOL_CURRENT_ENV});
    // CloudBase's relational API treats the `database` option as the PostgreSQL
    // schema. The SDK default is the environment id, which is not a valid
    // schema name for this environment; use public unless explicitly changed.
    rdb = app.rdb({instance:process.env.CLOUDBASE_PG_INSTANCE||'default',database:process.env.CLOUDBASE_PG_DATABASE||'public'});
    db = createDocumentCompat(rdb);
  }
  return { app, db };
}
const API='https://developer.kdocs.cn';
const OAUTH_API='https://openapi.wps.cn';
const json=(statusCode,body,headers={})=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':process.env.FRONTEND_URL||'','access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type,x-wps-app-id,x-wps-app-key',...headers},body:JSON.stringify(body)});
const required=name=>{const value=process.env[name];if(!value)throw new Error(`缺少环境变量 ${name}`);return value;};
const b64=value=>Buffer.from(value).toString('base64url');
const unb64=value=>Buffer.from(value,'base64url').toString();

function sign(value,secret=required('SESSION_SECRET')) { return b64(crypto.createHmac('sha256',secret).update(value).digest()); }
function makeToken(payload,ttlSeconds=3600) { const data=b64(JSON.stringify({...payload,exp:Date.now()+ttlSeconds*1000})); return `${data}.${sign(data)}`; }
function verifyToken(token) { if(!token)return null; const [data,signature]=token.split('.'); if(!data||!signature||sign(data)!==signature)return null; const payload=JSON.parse(unb64(data)); return payload.exp>Date.now()?payload:null; }
function cookie(event,name) { const raw=event.headers?.cookie||event.headers?.Cookie||''; return raw.split(';').map(item=>item.trim().split('=')).find(([key])=>key===name)?.[1]; }
function header(event,name) { const target=name.toLowerCase(); const headers=event.headers||{}; const found=Object.entries(headers).find(([key])=>key.toLowerCase()===target); return found?.[1]; }
function wpsCredentials(event) { return {appId:header(event,'x-wps-app-id')||process.env.WPS_APP_ID||required('WPS_APP_ID'),appKey:header(event,'x-wps-app-key')||process.env.WPS_APP_KEY||required('WPS_APP_KEY')}; }
function wpsRedirectUri(event) { if(process.env.WPS_REDIRECT_URI)return process.env.WPS_REDIRECT_URI; const host=header(event,'host'); if(host)return `https://${host}/worklog-api/api/auth/wps/callback`; return required('WPS_REDIRECT_URI'); }
function readWpsCookie(event) { const value=cookie(event,'worklog_wps_app_key'); return value?decrypt(decodeURIComponent(value)):null; }
function encrypt(value) { const key=crypto.createHash('sha256').update(required('TOKEN_ENCRYPTION_KEY')).digest(); const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key,iv); const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.'); }
function decrypt(value) { const [iv,tag,body]=value.split('.').map(item=>Buffer.from(item,'base64')); const key=crypto.createHash('sha256').update(required('TOKEN_ENCRYPTION_KEY')).digest(); const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(body),decipher.final()]).toString(); }
async function wps(path,accessToken,init={}) { const url=new URL(`${API}${path}`); url.searchParams.set('access_token',accessToken); const response=await fetch(url,{...init,headers:{'content-type':'application/json',...init.headers}}); const data=await response.json(); if(!response.ok||data.code&&data.code!==0)throw new Error(data.message||data.msg||`WPS 接口失败 ${response.status}`); return data.data??data; }
async function wpsFiles(keyword,accessToken) { const url=new URL('https://openapi.wps.cn/v7/files/search'); if(keyword)url.searchParams.set('keyword',keyword); url.searchParams.set('type','file_name'); url.searchParams.set('file_type','file'); const response=await fetch(url,{headers:{accept:'application/json',authorization:`Bearer ${accessToken}`}}); const body=await response.json(); if(!response.ok||body.code&&body.code!==0)throw new Error(body.message||body.msg||'WPS 文件列表读取失败'); const data=body.data||{}; const items=data.items||data.files||data.list||[]; return {files:items.map(item=>({id:String(item.id||item.file_id||item.fileId),name:item.name||item.file_name||item.fileName||'未命名文件',size:item.size,modifiedAt:item.modify_time?new Date(item.modify_time*1000).toISOString():item.updateTime,type:item.file_type||item.type}))}; }
async function owner() { await ensureCloud(); const result=await db.collection('app_config').doc('owner').get().catch(()=>({data:null})); return result.data; }
async function requireOwner(event) { const session=verifyToken(cookie(event,'worklog_session')); if(!session)throw Object.assign(new Error('请先使用 WPS 登录'),{status:401}); const locked=await owner(); if(!locked||locked.openId!==session.openId)throw Object.assign(new Error('该应用已绑定其他 WPS 账号'),{status:403}); return session; }
async function integration(openId) { const result=await db.collection('integrations').doc(openId).get(); if(!result.data)throw new Error('未找到 WPS 授权'); const data=result.data; return {...data,accessToken:decrypt(data.accessToken),refreshToken:decrypt(data.refreshToken)}; }
async function freshToken(openId) { let item=await integration(openId); if(item.expiresAt>Date.now()+300000)return item.accessToken; const appId=item.appId?decrypt(item.appId):required('WPS_APP_ID'); const appKey=item.appKey?decrypt(item.appKey):required('WPS_APP_KEY'); const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:item.refreshToken,client_id:appId,client_secret:appKey}); const response=await fetch(`${OAUTH_API}/oauth2/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); const body=await response.json(); const token=body.data??body; if(!response.ok||body.code&&body.code!==0||!token.access_token)throw new Error('WPS 授权已过期，请重新登录'); await db.collection('integrations').doc(openId).update({accessToken:encrypt(token.access_token),refreshToken:encrypt(token.refresh_token||item.refreshToken),expiresAt:Date.now()+Number(token.expires_in||7200)*1000,updatedAt:new Date()}); return token.access_token; }
async function upsertRecords(ownerId,records,syncId) { await ensureCloud(); for(let index=0;index<records.length;index+=40){await Promise.all(records.slice(index,index+40).map(record=>db.collection('records').doc(`${ownerId}-${record.id}`).set({...record,ownerId,syncId,updatedAt:new Date()})));} const old=await db.collection('records').where({ownerId}).limit(1000).get(); const current=new Set(records.map(record=>`${ownerId}-${record.id}`)); await Promise.all(old.data.filter(item=>!current.has(item._id)).map(item=>db.collection('records').doc(item._id).remove())); }
async function runSync(openId) { await ensureCloud(); importerModule ??= await import('./importer.mjs'); const { importXlsxBuffer }=importerModule; const syncId=crypto.randomUUID(); const startedAt=new Date(); await db.collection('sync_runs').add({ownerId:openId,syncId,status:'running',startedAt}); try { const accessToken=await freshToken(openId); const fileToken=required('WPS_FILE_TOKEN'); const download=await wps(`/api/v1/openapi/personal/files/${encodeURIComponent(fileToken)}/download`,accessToken); const downloadUrl=download.url||download.download_url; if(!downloadUrl)throw new Error('WPS 未返回文件下载地址'); const buffer=Buffer.from(await (await fetch(downloadUrl)).arrayBuffer()); const parsed=importXlsxBuffer(buffer,{year:Number(process.env.WPS_SOURCE_YEAR||2026),sheetName:process.env.WPS_SOURCE_SHEET||'Sheet1'}); for(const image of parsed.images.values()){const cloudPath=`work-review/${openId}/${image.id}.${image.extension}`; await app.uploadFile({cloudPath,fileContent:image.bytes}); await db.collection('images').doc(`${openId}-${image.id}`).set({ownerId:openId,imageId:image.id,name:image.name,cloudPath,updatedAt:new Date()});} await upsertRecords(openId,parsed.records,syncId); await db.collection('sync_runs').where({syncId}).update({status:'success',finishedAt:new Date(),recordCount:parsed.records.length,imageCount:parsed.imageCount}); return {status:'success',imported:parsed.records.length,images:parsed.imageCount}; } catch(error) { await db.collection('sync_runs').where({syncId}).update({status:'failed',finishedAt:new Date(),message:error.message}); throw error; } }
async function dataset(openId) { const [records,cases,lastSync]=await Promise.all([db.collection('records').where({ownerId:openId}).limit(1000).get(),db.collection('cases').where({ownerId:openId}).limit(1000).get(),db.collection('sync_runs').where({ownerId:openId,status:'success'}).orderBy('finishedAt','desc').limit(1).get()]); const sorted=records.data.sort((a,b)=>a.date.localeCompare(b.date)||a.sourceRow-b.sourceRow); return {meta:{sourceName:'WPS 云文档',sheetName:process.env.WPS_SOURCE_SHEET||'Sheet1',year:Number(process.env.WPS_SOURCE_YEAR||2026),importedAt:lastSync.data[0]?.finishedAt||new Date().toISOString(),sourceMode:'wps',imageCount:sorted.reduce((sum,item)=>sum+item.steps.filter(step=>step.kind==='image').length,0),warnings:[]},records:sorted.map(({_id,ownerId,syncId,updatedAt,...record})=>record),cases:cases.data.map(({_id,ownerId,...item})=>item)}; }
async function userSettings(openId) { const result=await db.collection('user_settings').doc(openId).get().catch(()=>({data:null})); if(!result.data)return {}; const { _id, ownerId, updatedAt, ...settings }=result.data; return settings; }
async function fileSearchRoute(event) { const session=await requireOwner(event); const keyword=event.queryStringParameters?.keyword||''; return json(200,await wpsFiles(keyword,await freshToken(session.openId))); }
// WPS 开放平台新版 OAuth（当前 open.wps.cn 控制台使用）。保留旧版文件同步接口，避免影响已有数据。
async function currentAuthRoute(event) {
  const path=(event.path||event.rawPath||'/').replace(/^\/worklog-api/,'');
  if(path==='/api/auth/wps/start') {
    const credentials=wpsCredentials(event);
    if(/^https?:\/\//i.test(credentials.appKey.trim()))return json(400,{message:'WPS App Key 不能是网址，请填写 WPS 开放平台应用信息中的 App Key'});
    const nonce=crypto.randomUUID();
    const state=makeToken({nonce,appId:credentials.appId,appKey:encrypt(credentials.appKey)},600);
    const url=new URL(`${OAUTH_API}/oauth2/auth`);
    url.searchParams.set('response_type','code');
    url.searchParams.set('client_id',credentials.appId);
    url.searchParams.set('redirect_uri',wpsRedirectUri(event));
    url.searchParams.set('scope','kso.user_base.read,kso.file.search,kso.file.read');
    url.searchParams.set('state',state);
    return json(200,{url:url.toString()},{'set-cookie':`worklog_wps_app_key=${encodeURIComponent(encrypt(credentials.appKey))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`});
  }
  if(path==='/api/auth/wps/callback') {
    const query=event.queryStringParameters||{};
    const state=verifyToken(query.state);
    if(!state)return json(400,{message:'授权状态已失效'});
    if(!query.code)return json(400,{message:query.error_description||query.error||'WPS 未返回授权码'});
    const appId=state.appId||required('WPS_APP_ID');
    const appKey=process.env.WPS_APP_KEY||(state.appKey?decrypt(state.appKey):null)||readWpsCookie(event)||required('WPS_APP_KEY');
    const form=new URLSearchParams({grant_type:'authorization_code',client_id:appId,client_secret:appKey,code:query.code,redirect_uri:wpsRedirectUri(event)});
    const tokenResponse=await fetch(`${OAUTH_API}/oauth2/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
    const tokenBody=await tokenResponse.json();
    const token=tokenBody.data??tokenBody;
    if(!tokenResponse.ok||tokenBody.code&&tokenBody.code!==0||!token.access_token)throw new Error(tokenBody.msg||tokenBody.message||'换取 WPS 令牌失败');
    const userResponse=await fetch(`${OAUTH_API}/v7/users/current`,{headers:{accept:'application/json',authorization:`Bearer ${token.access_token}`}});
    const userBody=await userResponse.json();
    const user=userBody.data??userBody;
    if(!userResponse.ok||userBody.code&&userBody.code!==0)throw new Error(userBody.msg||userBody.message||'读取 WPS 用户信息失败');
    const openId=String(user.openid||user.open_id||user.id||user.user_id);
    if(!openId||openId==='undefined')throw new Error('WPS 用户信息缺少用户标识');
    const locked=await owner();
    if(locked&&locked.openId!==openId)return json(403,{message:'该应用已绑定其他 WPS 账号'});
    if(!locked)await db.collection('app_config').doc('owner').set({openId,createdAt:new Date()});
    await db.collection('integrations').doc(openId).set({openId,displayName:user.nickname||user.name||user.display_name||'我',appId:encrypt(appId),appKey:encrypt(appKey),accessToken:encrypt(token.access_token),refreshToken:encrypt(token.refresh_token),expiresAt:Date.now()+Number(token.expires_in||7200)*1000,updatedAt:new Date()});
    const session=makeToken({openId},86400*30);
    return {statusCode:302,headers:{location:process.env.FRONTEND_URL||'/', 'set-cookie':`worklog_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`},body:''};
  }
  return null;
}
async function route(event) { const method=(event.httpMethod||event.requestContext?.http?.method||'GET').toUpperCase(); const path=(event.path||event.rawPath||'/').replace(/^\/worklog-api/,''); if(method==='OPTIONS')return json(204,{}); if(path==='/api/health'){await ensureCloud();const probe=await db.collection('app_config').doc('__health__').get();return json(200,{ok:true,storage:'postgresql',configured:Boolean(probe.data)});} if(path==='/api/auth/wps/start'){const credentials=wpsCredentials(event);const state=makeToken({nonce:crypto.randomUUID(),appId:credentials.appId},600);const url=new URL(`${API}/h5/auth`);url.searchParams.set('app_id',credentials.appId);url.searchParams.set('scope','user_basic,access_personal_files,download_personal_files');url.searchParams.set('redirect_uri',wpsRedirectUri(event));url.searchParams.set('state',state);return json(200,{url:url.toString()},{'set-cookie':`worklog_wps_app_key=${encodeURIComponent(encrypt(credentials.appKey))}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/wps; Max-Age=600`});} if(path==='/api/auth/wps/callback'){const query=event.queryStringParameters||{};const state=verifyToken(query.state);if(!state)return json(400,{message:'授权状态已失效'});const appId=state.appId||required('WPS_APP_ID');const appKey=process.env.WPS_APP_KEY||readWpsCookie(event)||required('WPS_APP_KEY');const tokenResponse=await fetch(`${API}/api/v1/oauth2/access_token?code=${encodeURIComponent(query.code)}&app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}`);const tokenBody=await tokenResponse.json();if(!tokenResponse.ok||tokenBody.code!==0)throw new Error('换取 WPS 令牌失败');const token=tokenBody.data;const user=await wps('/api/v1/openapi/user/basic',token.access_token);const openId=String(user.openid||user.open_id||user.id);const locked=await owner();if(locked&&locked.openId!==openId)return json(403,{message:'该应用已绑定其他 WPS 账号'});if(!locked)await db.collection('app_config').doc('owner').set({openId,createdAt:new Date()});await db.collection('integrations').doc(openId).set({openId,displayName:user.nickname||user.name||'我',appId:encrypt(appId),appKey:encrypt(appKey),accessToken:encrypt(token.access_token),refreshToken:encrypt(token.refresh_token),expiresAt:Date.now()+token.expires_in*1000,updatedAt:new Date()});const session=makeToken({openId},86400*30);return {statusCode:302,headers:{location:process.env.FRONTEND_URL||'/', 'set-cookie':`worklog_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`},body:''};} const session=await requireOwner(event); if(path==='/api/dataset'&&method==='GET')return json(200,await dataset(session.openId)); if(path==='/api/sync'&&method==='POST')return json(200,await runSync(session.openId)); if(path.startsWith('/api/images/')&&method==='GET'){const imageId=decodeURIComponent(path.slice('/api/images/'.length));const found=await db.collection('images').where({ownerId:session.openId,imageId}).limit(1).get();if(!found.data[0])return json(404,{message:'图片不存在'});const temp=await app.getTempFileURL({fileList:[found.data[0].cloudPath],maxAge:300});const url=temp.fileList?.[0]?.tempFileURL||temp.fileList?.[0]?.tempFileUrl;if(!url)return json(404,{message:'图片地址暂不可用'});return json(200,{url});} if(path==='/api/settings'&&method==='GET')return json(200,await userSettings(session.openId)); if(path==='/api/settings'&&method==='PUT'){const body=JSON.parse(event.body||'{}');if(!Array.isArray(body.cases))return json(400,{message:'cases 必须为数组'});const settings={cases:body.cases,categoryGroups:body.categoryGroups||{},customAssociations:body.customAssociations||[],associationExclusions:body.associationExclusions||[],ownerId:session.openId,updatedAt:new Date()};await db.collection('user_settings').doc(session.openId).set(settings);return json(200,{ok:true});} if(path==='/api/cases'&&method==='PUT'){const body=JSON.parse(event.body||'{}');if(!Array.isArray(body.cases))return json(400,{message:'cases 必须为数组'});const existing=await db.collection('cases').where({ownerId:session.openId}).limit(1000).get();await Promise.all(existing.data.map(item=>db.collection('cases').doc(item._id).remove()));const records=await db.collection('records').where({ownerId:session.openId}).limit(1000).get();await Promise.all(records.data.map(item=>db.collection('records').doc(item._id).update({caseId:null,effectiveCategory:item.originalCategory})));await Promise.all(body.cases.map(async item=>{await db.collection('cases').doc(`${session.openId}-${item.id}`).set({...item,ownerId:session.openId,updatedAt:new Date()});await Promise.all((item.recordIds||[]).map(recordId=>db.collection('records').doc(`${session.openId}-${recordId}`).update({caseId:item.id,effectiveCategory:item.categoryOverride||undefined})));}));return json(200,{ok:true});} return json(404,{message:'接口不存在'}); }

export async function main(event) { try { if(!event?.httpMethod&&!event?.requestContext?.http?.method){const locked=await owner();if(!locked)return {status:'skipped',reason:'owner-not-configured'};return runSync(locked.openId);} const currentAuth=await currentAuthRoute(event); if(currentAuth)return currentAuth; return await route(event); } catch(error) { console.error(error); return json(error.status||500,{message:error.message||'服务器错误'}); } }
