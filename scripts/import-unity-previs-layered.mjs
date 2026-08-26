import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {importLayeredExport} from './lib/unity-previs/layered-adapter.mjs';
const [directory,expectedPath,flag]=process.argv.slice(2);
try{
  if(!directory||!expectedPath||(flag&&flag!=='--write'))throw new Error('Usage: node scripts/import-unity-previs-layered.mjs <export-directory> <expected-scene.json> [--write]');
  const result=await importLayeredExport(resolve(directory),JSON.parse(await readFile(expectedPath,'utf8')));
  if(flag==='--write'){
    // Single immutable combined receipt avoids half-written pack/encoding pairs.
    await writeFile(resolve(directory,'layered-control-receipt.json'),JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx'});
  }
  console.log(JSON.stringify({valid:true,layers:result.pack.layers.length,skeletonArtifacts:result.pack.skeletonArtifacts.length,packDigest:result.pack.packDigest,written:flag==='--write'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
