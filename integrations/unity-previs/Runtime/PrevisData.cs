using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryboardPrevis {
[Serializable] public class ExchangeSource { public string stageId, stageDigest, shotId, snapshotId, cameraId; public int stageRevision; }
[Serializable] public class ShotCamera { public Vector3 position,target,up=Vector3.up; public float fov=50,near=.01f,far=20; public int width=960,height=540; }
[Serializable] public class PartData { public string id,kind; public Vector3 position,size=Vector3.one; public Quaternion rotation=Quaternion.identity; public float[] color={.55f,.65f,.75f}; }
[Serializable] public class JointData { public string id,parentId="",hand=""; public Vector3 position; public Quaternion rotation=Quaternion.identity; public float radius=.025f; public int openPoseIndex=-1,handIndex=-1; }
[Serializable] public class BoneData { public string from,to; public float radius=.04f; }
[Serializable] public class AttachmentData { public string id,jointId=""; public Vector3 position; }
[Serializable] public class EntityData { public string id,label,role; public Vector3 position,scale=Vector3.one; public Quaternion rotation=Quaternion.identity; public PartData[] parts=Array.Empty<PartData>(); public JointData[] joints=Array.Empty<JointData>(); public BoneData[] bones=Array.Empty<BoneData>(); public AttachmentData[] attachments=Array.Empty<AttachmentData>(); }
[Serializable] public class RelationData { public string kind,subjectId,targetId,attachmentId=""; public Vector3 targetPoint,interiorMin,interiorMax; public float tolerance=.025f; }
[Serializable] public class ExchangeScene { public int schemaVersion=1; public string coordinateSystem="RH_Y_UP_METRES",id,label; public ExchangeSource source; public ShotCamera camera=new ShotCamera(); public EntityData[] entities; public RelationData[] relations=Array.Empty<RelationData>(); }
[Serializable] public class CheckResult { public string kind,subjectId,targetId,attachmentId,message; public float distance,tolerance; public bool valid; }
[Serializable] public class PreflightReport { public bool valid; public string[] errors; public CheckResult[] checks; public string collisionScope="proxy bounds and declared attachment distances; not arbitrary mesh collision or automatic IK"; }
public static class SpaceMap {
    public static Vector3 Position(Vector3 p) { return new Vector3(p.x,p.y,-p.z); }
    public static Quaternion Rotation(Quaternion q) { return new Quaternion(-q.x,-q.y,q.z,q.w); }
    public static bool Finite(float f) { return !float.IsNaN(f)&&!float.IsInfinity(f); }
    public static bool Finite(Vector3 v) { return Finite(v.x)&&Finite(v.y)&&Finite(v.z); }
    public static bool Unit(Quaternion q) { return Finite(q.x)&&Finite(q.y)&&Finite(q.z)&&Finite(q.w)&&Mathf.Abs(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w-1)<.001f; }
    // Explicit prototype limits prevent finite-but-unusable transforms and unbounded allocation.
    static bool Bounded(Vector3 v, float limit=10000) {
        return Finite(v)&&Mathf.Abs(v.x)<=limit&&Mathf.Abs(v.y)<=limit&&Mathf.Abs(v.z)<=limit;
    }
    static bool Positive(Vector3 v, float limit) { return Bounded(v,limit)&&v.x>0&&v.y>0&&v.z>0; }
    static bool Radius(float value) { return Finite(value)&&value>0&&value<=100; }
    static bool SafeId(string value) {
        if(string.IsNullOrEmpty(value)||value.Length>128) return false;
        foreach(char c in value) if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-')) return false;
        return true;
    }
    static bool OptionalId(string value) { return value!=null&&(value.Length==0||SafeId(value)); }
    static bool Digest(string value) {
        if(value==null||value.Length!=64) return false;
        foreach(char c in value) if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))) return false;
        return true;
    }
    static bool Collection<T>(T[] values, int max, string field, List<string> errors) {
        if(values==null||values.Length>max) { errors.Add(field+": missing collection or exceeds limit "+max);return false; }
        return true;
    }
    public static string[] Validate(ExchangeScene s) {
        var errors=new List<string>();
        if(s==null||s.schemaVersion!=1||s.coordinateSystem!="RH_Y_UP_METRES") return new[]{"unsupported exchange schema or coordinate system"};
        if(!SafeId(s.id)) errors.Add("scene.id: invalid identifier");
        var source=s.source;
        if(source==null) errors.Add("missing source");
        else if(!SafeId(source.stageId)||!SafeId(source.shotId)||!SafeId(source.snapshotId)||!SafeId(source.cameraId)||!Digest(source.stageDigest)||source.stageRevision<0) errors.Add("invalid source IDs, SHA-256 digest or revision");
        var c=s.camera;
        if(c==null) errors.Add("missing camera");
        else if(!Bounded(c.position)||!Bounded(c.target)||!Bounded(c.up)||Vector3.Cross(c.target-c.position,c.up).sqrMagnitude<1e-10f||!Finite(c.fov)||c.fov<=1||c.fov>=179||!Finite(c.near)||!Finite(c.far)||c.near<=0||c.far<=c.near||c.far>100000||c.width<16||c.width>4096||c.height<16||c.height>4096) errors.Add("invalid shot camera");
        bool entitiesValid=Collection(s.entities,256,"entities",errors);
        bool relationsValid=Collection(s.relations,4096,"relations",errors);
        if(!entitiesValid||!relationsValid) return errors.ToArray();
        if(s.entities.Length==0) errors.Add("entities: scene must not be empty");
        var entities=new Dictionary<string,EntityData>();
        foreach(var e in s.entities) {
            if(e==null||!SafeId(e.id)||entities.ContainsKey(e.id)) {errors.Add("missing/invalid/duplicate entity id");continue;}
            entities.Add(e.id,e);
            ValidateEntity(e,errors);
        }
        foreach(var r in s.relations) {
            if(r==null||!SafeId(r.subjectId)||!SafeId(r.targetId)||!entities.ContainsKey(r.subjectId)||!entities.ContainsKey(r.targetId)||r.subjectId==r.targetId||!(r.kind=="inside"||r.kind=="contact")||!Finite(r.tolerance)||r.tolerance<0||r.tolerance>10) {errors.Add("unsupported or invalid relation");continue;}
            var subject=entities[r.subjectId];
            if(r.kind=="contact"&&(!SafeId(r.attachmentId)||!Bounded(r.targetPoint)||subject.attachments==null||!Array.Exists(subject.attachments,a=>a!=null&&a.id==r.attachmentId))) errors.Add(r.subjectId+": invalid contact point or missing contact attachment");
            if(r.kind=="inside"&&(!Bounded(r.interiorMin)||!Bounded(r.interiorMax)||r.interiorMin.x>=r.interiorMax.x||r.interiorMin.y>=r.interiorMax.y||r.interiorMin.z>=r.interiorMax.z)) errors.Add(r.targetId+": invalid interior bounds");
        }
        return errors.ToArray();
    }
    static void ValidateEntity(EntityData e,List<string> errors) {
        if(!(e.role=="subject"||e.role=="environment"||e.role=="interaction"||e.role=="foreground_occluder")) errors.Add(e.id+": unsupported role");
        if(!Bounded(e.position)||!Positive(e.scale,100)||!Unit(e.rotation)) errors.Add(e.id+": invalid transform");
        // Evaluate all four gates, without dereferencing malformed arrays later.
        bool collections=Collection(e.parts,1024,e.id+".parts",errors);
        collections=Collection(e.joints,1024,e.id+".joints",errors)&&collections;
        collections=Collection(e.bones,1024,e.id+".bones",errors)&&collections;
        collections=Collection(e.attachments,1024,e.id+".attachments",errors)&&collections;
        if(!collections) return;
        var joints=new Dictionary<string,JointData>();
        var body=new HashSet<int>();var left=new HashSet<int>();var right=new HashSet<int>();
        foreach(var j in e.joints) {
            if(j==null||!SafeId(j.id)||joints.ContainsKey(j.id)) {errors.Add(e.id+": duplicate/invalid/missing joint");continue;}
            joints.Add(j.id,j);
            if(!Bounded(j.position)||!Unit(j.rotation)||!Radius(j.radius)||!OptionalId(j.parentId)) errors.Add(e.id+":"+j.id+": invalid joint transform or parent");
            if(j.openPoseIndex < -1||j.openPoseIndex>17||(j.openPoseIndex>=0&&!body.Add(j.openPoseIndex))) errors.Add(e.id+":"+j.id+": invalid or duplicate body index");
            bool hand=j.hand=="left"||j.hand=="right";
            if(!(hand||j.hand==""||j.hand=="none")||j.handIndex < -1||j.handIndex>20||(hand&&j.handIndex<0)||(!hand&&j.handIndex!=-1)) errors.Add(e.id+":"+j.id+": invalid hand mapping");
            else if(hand&&!(j.hand=="left"?left:right).Add(j.handIndex)) errors.Add(e.id+":"+j.id+": duplicate hand index");
        }
        if(e.role=="subject"&&(body.Count!=18||left.Count!=21||right.Count!=21)) errors.Add(e.id+": subject requires complete body18 and both hand21 mappings");
        foreach(var j in joints.Values) {
            var visited=new HashSet<string>();var current=j;
            while(!string.IsNullOrEmpty(current.parentId)) {
                if(!visited.Add(current.id)) {errors.Add(e.id+":"+j.id+": cyclic joints");break;}
                JointData parent;
                if(!joints.TryGetValue(current.parentId,out parent)) {errors.Add(e.id+":"+j.id+": missing parent joint");break;}
                current=parent;
            }
        }
        foreach(var b in e.bones) if(b==null||!SafeId(b.from)||!SafeId(b.to)||b.from==b.to||!joints.ContainsKey(b.from)||!joints.ContainsKey(b.to)||!Radius(b.radius)) errors.Add(e.id+": invalid bone");
        var attachmentIds=new HashSet<string>();
        foreach(var a in e.attachments) if(a==null||!SafeId(a.id)||!attachmentIds.Add(a.id)||!Bounded(a.position)||!OptionalId(a.jointId)||(!string.IsNullOrEmpty(a.jointId)&&!joints.ContainsKey(a.jointId))) errors.Add(e.id+": invalid/duplicate attachment");
        var partIds=new HashSet<string>();
        foreach(var p in e.parts) if(p==null||!SafeId(p.id)||!partIds.Add(p.id)||!(p.kind=="box"||p.kind=="sphere"||p.kind=="capsule"||p.kind=="cylinder")||!Bounded(p.position)||!Positive(p.size,1000)||!Unit(p.rotation)||p.color==null||p.color.Length!=3||Array.Exists(p.color,x=>!Finite(x)||x<0||x>1)) errors.Add(e.id+": invalid/duplicate part");
    }
}
}
