import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateExport} from './exchange.mjs';
import {createLayeredSpatialControlPack,validateLayeredSpatialControlPack} from '../../../src/modules/spatial-stage/layeredSpatialControlPackRuntime.mjs';

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return typeof value==='number'?Math.round(value*1e5)/1e5:value;}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Pure assembly only; public filesystem import below first checks hashes, PNGs and input freshness.
export function buildLayeredPack(scene,manifest,directory,preflight){
  if(!preflight?.valid||preflight.errors?.length)throw new Error('unity_layered_preflight_failed');
  const artifact=(id,kind)=>{const item=manifest.artifacts.find(a=>a.entityId===id&&a.kind===kind);if(!item)throw new Error(`unity_layered_artifact_missing:${id}:${kind}`);return {kind:kind==='visible_mask'?'mask':kind,filePath:resolve(directory,item.filePath),sha256:item.sha256,width:item.width,height:item.height};};
  const c=scene.camera,forward={x:c.target.x-c.position.x,y:c.target.y-c.position.y,z:c.target.z-c.position.z};
  const sorted=[...scene.entities].sort((a,b)=>{const depth=e=>(e.position.x-c.position.x)*forward.x+(e.position.y-c.position.y)*forward.y+(e.position.z-c.position.z)*forward.z;return depth(b)-depth(a)||a.id.localeCompare(b.id);});
  const layers=sorted.map((e,order)=>({layerId:`unity-${e.id}`,order,role:e.role,entityIds:[e.id],artifacts:['color','depth','normal','visible_mask'].map(k=>artifact(e.id,k))}));
  const skeletonArtifacts=scene.entities.filter(e=>e.role==='subject').flatMap(e=>['openpose','hand_pose','contact_map'].map(kind=>({...artifact(e.id,kind),entityId:e.id})));
  const source=scene.source;
  const pack=createLayeredSpatialControlPack({stageId:source.stageId,stageRevision:source.stageRevision,stageDigest:digest(scene),shotId:source.shotId,snapshotId:source.snapshotId,cameraId:source.cameraId,cameraDigest:digest(c),contractDigest:digest(scene.relations),preflightDigest:digest(preflight),layers,skeletonArtifacts});
  const checked=validateLayeredSpatialControlPack(pack,pack);if(!checked.valid)throw new Error(checked.reason);
  return {pack,encodings:{schemaVersion:1,renderer:'Unity 2022.3 built-in',source,exchangeDigest:pack.stageDigest,camera:c,layerColorPolicy:'isolated entity color; compose only through visible mask',depthPolicy:'linear eye distance: 1-(z-near)/(far-near), black background',normalPolicy:'right-handed view-space unit normal mapped [-1,1] to [0,1]',posePolicy:'body18 and hand21 projected from actual hierarchy; cropped endpoints omitted; see projected-joints.json',artifacts:manifest.artifacts.map(({kind,entityId,filePath,encoding})=>({kind,entityId,filePath,encoding}))}};
}

export async function importLayeredExport(directory,expectedScene){
  const verified=await validateExport(directory,expectedScene);if(!verified.valid)throw new Error(`unity_export_invalid:${JSON.stringify(verified.errors)}`);
  const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
  const scene=JSON.parse(await readFile(resolve(directory,manifest.sceneFile),'utf8'));
  const preflight=JSON.parse(await readFile(resolve(directory,manifest.preflightFile),'utf8'));
  return buildLayeredPack(scene,manifest,directory,preflight);
}
