using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryboardPrevis {
public sealed class PrevisScene : IDisposable {
    public ExchangeScene Data {get;private set;}
    public string OriginalJson {get;private set;}
    public GameObject Root {get;private set;}
    public Camera Camera {get;private set;}
    public readonly Dictionary<string,GameObject> Entities=new Dictionary<string,GameObject>();
    public readonly Dictionary<string,Dictionary<string,Transform>> Joints=new Dictionary<string,Dictionary<string,Transform>>();
    public readonly Dictionary<Renderer,string> Renderers=new Dictionary<Renderer,string>();
    public readonly Dictionary<Renderer,float> GeometryScales=new Dictionary<Renderer,float>();
    readonly List<Material> materials=new List<Material>();
    readonly List<Action> updateBones=new List<Action>();
    public void Load(ExchangeScene input) {
        var errors=SpaceMap.Validate(input); if(errors.Length>0) throw new Exception(string.Join("; ",errors));
        Dispose(); OriginalJson=JsonUtility.ToJson(input,true); Data=JsonUtility.FromJson<ExchangeScene>(OriginalJson);
        Root=new GameObject("Previs stage");
        foreach(var e in Data.entities) {
            var go=new GameObject(e.label??e.id);go.transform.SetParent(Root.transform,false);
            go.transform.localPosition=SpaceMap.Position(e.position);go.transform.localRotation=SpaceMap.Rotation(e.rotation);go.transform.localScale=e.scale;Entities.Add(e.id,go);
            foreach(var p in e.parts) {
                var obj=Primitive(e.id,p.kind,p.color);obj.name=p.id;obj.transform.SetParent(go.transform,false);obj.transform.localPosition=SpaceMap.Position(p.position);obj.transform.localRotation=SpaceMap.Rotation(p.rotation);
                obj.transform.localScale=new Vector3(p.size.x,(p.kind=="capsule"||p.kind=="cylinder")?p.size.y/2:p.size.y,p.size.z);
            }
            var map=new Dictionary<string,Transform>();Joints.Add(e.id,map);
            foreach(var j in e.joints) {var jt=new GameObject(j.id).transform;map.Add(j.id,jt);}
            foreach(var j in e.joints) {
                var jt=map[j.id];jt.SetParent(string.IsNullOrEmpty(j.parentId)?go.transform:map[j.parentId],false);jt.localPosition=SpaceMap.Position(j.position);jt.localRotation=SpaceMap.Rotation(j.rotation);
                var dot=Primitive(e.id,"sphere",new[]{.72f,.78f,.82f});dot.transform.SetParent(jt,false);dot.transform.localScale=Vector3.one*j.radius*2;
            }
            foreach(var b in e.bones) {
                var capsule=Primitive(e.id,"capsule",new[]{.56f,.65f,.72f});capsule.transform.SetParent(go.transform,false);
                var from=map[b.from];var to=map[b.to];
                updateBones.Add(()=>{var a=go.transform.InverseTransformPoint(from.position);var z=go.transform.InverseTransformPoint(to.position);var delta=z-a;capsule.transform.localPosition=(a+z)/2;capsule.transform.localRotation=delta.sqrMagnitude>.0000001f?Quaternion.FromToRotation(Vector3.up,delta):Quaternion.identity;capsule.transform.localScale=new Vector3(b.radius*2,Mathf.Max(delta.magnitude/2,b.radius),b.radius*2);});
            }
        }
        var cameraObject=new GameObject("Shot camera");cameraObject.transform.SetParent(Root.transform,false);Camera=cameraObject.AddComponent<Camera>();Camera.enabled=false;Camera.clearFlags=CameraClearFlags.SolidColor;Camera.backgroundColor=new Color(.055f,.07f,.09f);Camera.allowHDR=false;Camera.allowMSAA=false;
        ApplyCamera();UpdateGeometry();
    }
    public void LoadJson(string json) {Load(JsonUtility.FromJson<ExchangeScene>(json));OriginalJson=json;}
    public void LoadFile(string path) {
        var raw=System.IO.File.ReadAllText(path);var parsed=JsonUtility.FromJson<ExchangeScene>(raw);
        var sourcePath=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path)),"source-input.json");var origin=raw;
        if(System.IO.File.Exists(sourcePath)) {origin=System.IO.File.ReadAllText(sourcePath);var original=JsonUtility.FromJson<ExchangeScene>(origin);if(parsed?.source==null||original?.source==null||JsonUtility.ToJson(parsed.source)!=JsonUtility.ToJson(original.source))throw new Exception("source sidecar lineage mismatch");}
        Load(parsed);OriginalJson=origin;
    }
    public string Save() {var dir=PrevisPaths.NewRun("save");var path=System.IO.Path.Combine(dir,"scene.json");PrevisExport.Json(path,Capture());if(!string.IsNullOrEmpty(OriginalJson))System.IO.File.WriteAllText(System.IO.Path.Combine(dir,"source-input.json"),OriginalJson,PrevisExport.Utf8);return path;}
    GameObject Primitive(string entityId,string kind,float[] tint) {
        var shape=kind=="box"?PrimitiveType.Cube:kind=="sphere"?PrimitiveType.Sphere:kind=="cylinder"?PrimitiveType.Cylinder:PrimitiveType.Capsule;
        var obj=GameObject.CreatePrimitive(shape); var shader=Resources.Load<Shader>("Control"); if(shader==null) throw new Exception("Previs Control shader missing");
        var mat=new Material(shader);mat.SetColor("_Color",new Color(tint[0],tint[1],tint[2],1));materials.Add(mat);var renderer=obj.GetComponent<Renderer>();renderer.sharedMaterial=mat;Renderers.Add(renderer,entityId);return obj;
    }
    public void ApplyCamera() {var c=Data.camera;Camera.transform.position=SpaceMap.Position(c.position);Camera.transform.rotation=Quaternion.LookRotation(SpaceMap.Position(c.target-c.position),SpaceMap.Position(c.up));Camera.fieldOfView=c.fov;Camera.nearClipPlane=c.near;Camera.farClipPlane=c.far;Camera.aspect=(float)c.width/c.height;}
    public void UpdateGeometry() {foreach(var update in updateBones) update();Physics.SyncTransforms();}
    public Bounds GeometryBounds(Renderer renderer) {
        var skinned=renderer as SkinnedMeshRenderer;if(skinned==null)return renderer.bounds;
        var baked=new Mesh();try{skinned.BakeMesh(baked);var vertices=baked.vertices;if(vertices.Length==0)return renderer.bounds;float scale;GeometryScales.TryGetValue(renderer,out scale);if(scale<=0)scale=1;var bounds=new Bounds(renderer.transform.TransformPoint(vertices[0]*scale),Vector3.zero);for(var i=1;i<vertices.Length;i++)bounds.Encapsulate(renderer.transform.TransformPoint(vertices[i]*scale));return bounds;}finally{UnityEngine.Object.DestroyImmediate(baked);}
    }
    public void ReplaceEntityVisual(string entityId,GameObject visual,Vector3 localPosition,Quaternion localRotation,Color tint,float bakedVertexScale=1) {
        if(!Entities.ContainsKey(entityId)||visual==null)throw new Exception("replacement visual invalid: "+entityId);
        var obsolete=new List<Renderer>();foreach(var kv in Renderers)if(kv.Value==entityId)obsolete.Add(kv.Key);
        foreach(var renderer in obsolete){renderer.enabled=false;Renderers.Remove(renderer);}
        var holder=new GameObject(entityId+" approved character holder");holder.transform.SetParent(Entities[entityId].transform,false);holder.transform.localPosition=localPosition;holder.transform.localRotation=localRotation;holder.transform.localScale=Vector3.one;
        visual.name=entityId+" approved character mesh";visual.transform.SetParent(holder.transform,false);
        var shader=Resources.Load<Shader>("Control");if(shader==null)throw new Exception("Previs Control shader missing");
        var replacements=visual.GetComponentsInChildren<Renderer>(true);if(replacements.Length==0)throw new Exception("replacement visual has no renderers: "+entityId);
        foreach(var renderer in replacements){
            var skinned=renderer as SkinnedMeshRenderer;if(skinned!=null)skinned.updateWhenOffscreen=true;
            var mat=new Material(shader);mat.SetColor("_Color",tint);materials.Add(mat);renderer.sharedMaterial=mat;renderer.enabled=true;Renderers.Add(renderer,entityId);GeometryScales.Add(renderer,bakedVertexScale);
        }
        UpdateGeometry();
    }
    public Vector3 Attachment(string entityId,string attachmentId) {var e=Array.Find(Data.entities,x=>x.id==entityId);var a=Array.Find(e.attachments,x=>x.id==attachmentId);if(a==null)throw new Exception("attachment missing: "+attachmentId);var t=string.IsNullOrEmpty(a.jointId)?Entities[entityId].transform:Joints[entityId][a.jointId];return t.TransformPoint(SpaceMap.Position(a.position));}
    public PreflightReport Preflight() {
        UpdateGeometry(); var errors=new List<string>(SpaceMap.Validate(Capture()));var checks=new List<CheckResult>();
        if(errors.Count>0)return new PreflightReport{valid=false,errors=errors.ToArray(),checks=checks.ToArray()};
        ApplyCamera();
        foreach(var r in Data.relations) {
            var check=new CheckResult{kind=r.kind,subjectId=r.subjectId,targetId=r.targetId,attachmentId=r.attachmentId,tolerance=r.tolerance,valid=true};
            if(r.kind=="contact") {var target=Entities[r.targetId].transform.TransformPoint(SpaceMap.Position(r.targetPoint));var actual=Attachment(r.subjectId,r.attachmentId);check.distance=Vector3.Distance(actual,target);check.valid=check.distance<=r.tolerance;check.message="attachment distance in metres";
                var projected=Camera.WorldToViewportPoint(actual);if(projected.z<Camera.nearClipPlane||projected.z>Camera.farClipPlane||projected.x<0||projected.x>1||projected.y<0||projected.y>1){check.valid=false;check.message="required contact outside shot camera";}
            }
            else {
                var target=Entities[r.targetId].transform;
                foreach(var kv in Renderers) if(kv.Value==r.subjectId) {
                    var b=GeometryBounds(kv.Key);
                    for(int i=0;i<8;i++) {var corner=b.center+Vector3.Scale(b.extents,new Vector3((i&1)==0?-1:1,(i&2)==0?-1:1,(i&4)==0?-1:1));var v=SpaceMap.Position(target.InverseTransformPoint(corner));
                        if(v.x<r.interiorMin.x-r.tolerance||v.y<r.interiorMin.y-r.tolerance||v.z<r.interiorMin.z-r.tolerance||v.x>r.interiorMax.x+r.tolerance||v.y>r.interiorMax.y+r.tolerance||v.z>r.interiorMax.z+r.tolerance) check.valid=false;
                    }
                } check.message="conservative rendered proxy AABB corners inside declared interior";
            }
            if(!check.valid) errors.Add(r.kind+":"+r.subjectId+":"+r.attachmentId);checks.Add(check);
        }
        return new PreflightReport{valid=errors.Count==0,errors=errors.ToArray(),checks=checks.ToArray()};
    }
    public ExchangeScene Capture() {
        foreach(var e in Data.entities) {var t=Entities[e.id].transform;e.position=SpaceMap.Position(t.localPosition);e.rotation=SpaceMap.Rotation(t.localRotation);e.scale=t.localScale;foreach(var j in e.joints){var jt=Joints[e.id][j.id];j.position=SpaceMap.Position(jt.localPosition);j.rotation=SpaceMap.Rotation(jt.localRotation);}}
        return JsonUtility.FromJson<ExchangeScene>(JsonUtility.ToJson(Data));
    }
    public void Dispose() {if(Root!=null)UnityEngine.Object.DestroyImmediate(Root);foreach(var m in materials)if(m!=null)UnityEngine.Object.DestroyImmediate(m);materials.Clear();Entities.Clear();Joints.Clear();Renderers.Clear();GeometryScales.Clear();updateBones.Clear();Root=null;}
}
}
