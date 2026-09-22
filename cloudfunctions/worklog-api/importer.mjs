import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import crypto from 'node:crypto';

const displayImagePattern = /DISPIMG\(\s*["']([^"']+)["']/i;
const textOf = value => value == null ? '' : String(value).trim();
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

function parseDate(value, year) {
  if (typeof value === 'number' && value > 31) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  const match = String(value ?? '').trim().replace(/[年月]/g,'.').replace(/日/g,'').match(/^(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})$/);
  if (!match) return null;
  const y=Number(match[1]||year),m=Number(match[2]),d=Number(match[3]);
  const date=new Date(y,m-1,d);
  return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}

function parseRelationships(xml) {
  const result=new Map(); let match; const pattern=/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/gi;
  while ((match=pattern.exec(xml))) result.set(match[1],match[2]);
  return result;
}

function extractImages(buffer) {
  const files=unzipSync(new Uint8Array(buffer)); const decoder=new TextDecoder();
  const cells=files['xl/cellimages.xml'], rels=files['xl/_rels/cellimages.xml.rels'];
  if (!cells||!rels) return new Map();
  const relationMap=parseRelationships(decoder.decode(rels)); const result=new Map();
  const blocks=decoder.decode(cells); let block; const pattern=/<etc:cellImage>([\s\S]*?)<\/etc:cellImage>/gi;
  while ((block=pattern.exec(blocks))) {
    const id=block[1].match(/<xdr:cNvPr\b[^>]*\bname="([^"]+)"/i)?.[1];
    const name=block[1].match(/<xdr:cNvPr\b[^>]*\bdescr="([^"]*)"/i)?.[1]||id;
    const rid=block[1].match(/<a:blip\b[^>]*(?:r:embed|embed)="([^"]+)"/i)?.[1];
    const target=rid&&relationMap.get(rid); const bytes=target&&files[`xl/${target.replace(/^\.\.\//,'')}`];
    if (id&&bytes) result.set(id,{id,name,bytes:Buffer.from(bytes),extension:target.split('.').pop().toLowerCase()});
  }
  return result;
}

export function importXlsxBuffer(buffer,{year=2026,sheetName='Sheet1'}={}) {
  const workbook=XLSX.read(buffer,{type:'buffer',cellFormula:true});
  const actualSheet=workbook.Sheets[sheetName]||workbook.Sheets[workbook.SheetNames.find(name=>!name.startsWith('WpsReserved_'))];
  if (!actualSheet) throw new Error('找不到可读取的工作表');
  const range=XLSX.utils.decode_range(actualSheet['!ref']||'A1:P1'); const images=extractImages(buffer); const records=[];
  let currentDate=null,currentWeekday='',imageCount=0;
  for (let row=1;row<=range.e.r;row+=1) {
    const cell=column=>actualSheet[XLSX.utils.encode_cell({r:row,c:column})];
    if (textOf(cell(0)?.v)) currentDate=cell(0).v; if (textOf(cell(1)?.v)) currentWeekday=textOf(cell(1).v);
    const title=textOf(cell(2)?.v); if (!title) continue; const date=parseDate(currentDate,year); if (!date) continue;
    const originalCategory=textOf(cell(3)?.v)||'未分类'; const steps=[];
    for (let column=4;column<=Math.min(15,range.e.c);column+=1) {
      const source=cell(column); if (!source) continue; const formula=textOf(source.f||source.v); const imageId=formula.match(displayImagePattern)?.[1];
      if (imageId) { imageCount+=1; steps.push({id:`${row+1}-${column+1}`,order:column-3,kind:'image',imageId,imageName:images.get(imageId)?.name||imageId}); }
      else if (textOf(source.v)) steps.push({id:`${row+1}-${column+1}`,order:column-3,kind:'text',text:textOf(source.v)});
    }
    const sourceSignature=hash(JSON.stringify([date,title,originalCategory,steps.map(step=>step.text||step.imageId)]));
    records.push({id:`record-${sourceSignature}-${row+1}`,sourceRow:row+1,date,weekday:currentWeekday,title,originalCategory,effectiveCategory:originalCategory,steps,sourceSignature});
  }
  return { records, images, imageCount, actualSheetName: workbook.SheetNames.find(name=>workbook.Sheets[name]===actualSheet)||sheetName };
}
