import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {writeFileAtomic} from './write-file-atomic.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BUDGET_FILE='DOCUMENT_CONTROLLER_DUPLICATION_BUDGET.json';
const OUTPUT_FILE='DOCUMENT_CONTROLLER_DUPLICATION_AUDIT_RESULTS.json';
const budget=JSON.parse(fs.readFileSync(path.join(ROOT,BUDGET_FILE),'utf8'));
const files=budget.controllers;

const EXTRACTED_PURE_HELPERS=Object.freeze([
  'escapeHtml','parseMoney','fmt','formatDate','thaiIntegerText','bahtText','safeFilename',
  'getNestedValue','setNestedValue','resolveStoragePeriod',
  'createDocumentLineItem','estimateDocumentItemRowUnits','calculateDocumentTotals',
  'selectPrintableDocumentItems','paginateDocumentItems'
]);
const SAFE_PURE_CANDIDATES=Object.freeze([]);
const CONTEXTUAL_CANDIDATES=Object.freeze([
  'branchCompany','getLockedBranch','addItem','removeItem',
  'documentPagesHtml','waitForPdfStageAssets'
]);
const KEEP_SEPARATE=Object.freeze([
  'createDefaultState','createDefaultDocNo','loadDraft','persistDraft','mountFeature','renderAppShell',
  'customerSectionHtml','documentSectionHtml','itemsSectionHtml','summarySectionHtml','sourceEvidenceHtml',
  'bindEvents','renderItemsEditor','renderTabs','renderPreview','documentPageHtml','validateBeforeSave',
  'saveDocumentToSystem','downloadPdf','printDocuments','handleTemplateUpload','showUploadedTemplate'
]);

const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const physicalLineCount=text=>{const lines=text.split(/\r?\n/);return lines.at(-1)===''?lines.length-1:lines.length;};
const sha=text=>crypto.createHash('sha1').update(text).digest('hex');
const normalize=text=>text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/\s+/g,' ').trim();

function extractTopLevelFunctions(file){
  const lines=read(file).split(/\r?\n/);
  const out=[];
  for(let i=0;i<lines.length;i+=1){
    const match=lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if(!match)continue;
    let end=i+1;
    while(end<lines.length&&!/^}\s*$/.test(lines[end]))end+=1;
    if(end>=lines.length)throw new Error(`Unable to find top-level closing brace for ${match[1]} in ${file}:${i+1}`);
    const block=lines.slice(i,end+1).join('\n');
    const body=block.replace(/^.*?\{\s*/s,'').replace(/\s*}\s*$/s,'');
    const normalized=normalize(body);
    out.push({name:match[1],line:i+1,lines:end-i+1,hash:sha(normalized),normalized});
    i=end;
  }
  return out;
}

function duplicateWindows(){
  const windows=new Map();
  for(const file of files){
    const lines=read(file).split(/\r?\n/);
    for(let i=0;i<=lines.length-10;i+=1){
      const chunk=normalize(lines.slice(i,i+10).join('\n'));
      if(chunk.length<220)continue;
      const rows=windows.get(chunk)||[];
      rows.push({file,line:i+1});
      windows.set(chunk,rows);
    }
  }
  return [...windows.values()].filter(rows=>new Set(rows.map(row=>row.file)).size>1);
}

const functions=Object.fromEntries(files.map(file=>[file,extractTopLevelFunctions(file)]));
const pairReports=[];
let exactSameNameFunctionPairs=0;
let sameNameFunctionPairs=0;
for(let i=0;i<files.length;i+=1){
  for(let j=i+1;j<files.length;j+=1){
    const left=files[i],right=files[j];
    const rightByName=new Map(functions[right].map(fn=>[fn.name,fn]));
    const pairs=functions[left].filter(fn=>rightByName.has(fn.name)).map(fn=>({left:fn,right:rightByName.get(fn.name)}));
    const exact=pairs.filter(pair=>pair.left.hash===pair.right.hash);
    sameNameFunctionPairs+=pairs.length;
    exactSameNameFunctionPairs+=exact.length;
    pairReports.push({
      left,right,
      leftFunctions:functions[left].length,
      rightFunctions:functions[right].length,
      sameNameFunctions:pairs.length,
      exactSameNameFunctions:exact.length,
      exactFunctions:exact.map(pair=>({name:pair.left.name,leftLine:pair.left.line,rightLine:pair.right.line,lines:Math.min(pair.left.lines,pair.right.lines)})),
      sameNameDifferentBody:pairs.filter(pair=>pair.left.hash!==pair.right.hash).map(pair=>pair.left.name)
    });
  }
}

const windows=duplicateWindows();
const occurrenceMap=name=>files.flatMap(file=>functions[file].filter(fn=>fn.name===name).map(fn=>({file,line:fn.line,lines:fn.lines,hash:fn.hash})));
const classify=names=>names.map(name=>({name,occurrences:occurrenceMap(name)})).filter(row=>row.occurrences.length>1);

const controllerImports={};
for(const file of files){
  const src=read(file);
  controllerImports[file]=files.filter(other=>other!==file&&new RegExp(`from\\s+['\"]\\./${other.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}['\"]`).test(src));
}
const crossControllerImports=Object.entries(controllerImports).flatMap(([file,imports])=>imports.map(target=>({file,target})));

const metrics={
  controllerLines:Object.fromEntries(files.map(file=>[file,physicalLineCount(read(file))])),
  totalControllerLines:files.reduce((sum,file)=>sum+physicalLineCount(read(file)),0),
  topLevelFunctions:Object.fromEntries(files.map(file=>[file,functions[file].length])),
  sameNameFunctionPairs,
  exactSameNameFunctionPairs,
  normalizedDuplicate10LineGroups:windows.length,
  crossControllerImports:crossControllerImports.length
};
const checks={
  normalizedWindowBudget:metrics.normalizedDuplicate10LineGroups<=budget.maxNormalizedDuplicate10LineGroups,
  exactFunctionBudget:metrics.exactSameNameFunctionPairs<=budget.maxExactSameNameFunctionPairs,
  noCrossControllerImports:crossControllerImports.length===0
};
const status=Object.values(checks).every(Boolean)?'PASS':'FAIL';
const report={
  release:'4.3.1',
  phase:'Step 3C-1 Issued Document Transaction & Sync Boundary',
  checkedAt:new Date().toISOString(),
  budgetFile:BUDGET_FILE,
  status,
  metrics,
  budget:{
    maxNormalizedDuplicate10LineGroups:budget.maxNormalizedDuplicate10LineGroups,
    maxExactSameNameFunctionPairs:budget.maxExactSameNameFunctionPairs
  },
  checks,
  pairReports,
  normalizedDuplicateWindowExamples:windows.slice(0,30),
  boundaryPlan:{
    extractedPureHelpers:EXTRACTED_PURE_HELPERS.map(name=>({
      name,
      sharedCoreExport:new RegExp(`export\\s+function\\s+${name}\\b`).test(read('erp-shared-core.js')),
      localDefinitions:occurrenceMap(name),
      importedBy:files.filter(file=>new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['\"]\\./erp-shared-core\\.js['\"]`).test(read(file)))
    })),
    safePureCandidates:classify(SAFE_PURE_CANDIDATES),
    contextualCandidates:classify(CONTEXTUAL_CANDIDATES),
    keepSeparate:classify(KEEP_SEPARATE),
    rule:'Step 3C-1 keeps document rendering controller-owned while issued Delivery/Tax and Receipt persistence must route through runDocumentAction plus the strict multi-key write session. Canonical source truth and accounting settlement remain outside the print/render layer.'
  },
  crossControllerImports
};
writeFileAtomic(path.join(ROOT,OUTPUT_FILE),JSON.stringify(report,null,2));
console.log(`Document Controller Duplication Audit: ${status}`);
console.log(`Controllers: ${metrics.totalControllerLines} lines · exact same-name pairs ${metrics.exactSameNameFunctionPairs}/${budget.maxExactSameNameFunctionPairs} · normalized 10-line groups ${metrics.normalizedDuplicate10LineGroups}/${budget.maxNormalizedDuplicate10LineGroups}`);
for(const pair of pairReports)console.log(`${pair.left} ↔ ${pair.right}: same-name ${pair.sameNameFunctions}, exact ${pair.exactSameNameFunctions}`);
if(status!=='PASS')process.exitCode=1;
