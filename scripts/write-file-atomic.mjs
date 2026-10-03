import fs from 'node:fs';
import path from 'node:path';

// Audit scripts rewrite *_RESULTS.json files that other test files read. The test runner
// runs files in parallel, so a plain writeFileSync (truncate, then write) could let a reader
// see an empty/half-written file. Write a temporary file in the same folder and rename it
// over the target instead: readers see either the old or the new complete file.
export function writeFileAtomic(file, data){
  const dir=path.dirname(file);
  const tmp=path.join(dir,`.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try{
    fs.writeFileSync(tmp,data);
    fs.renameSync(tmp,file);
  }catch(error){
    try{fs.rmSync(tmp,{force:true});}catch{/* the temporary file may not exist */}
    throw error;
  }
}
