using System;
using System.IO;
using UnityEngine;
using UnityEditor;

namespace StoryboardPrevis {
public static class PrevisChecks {
    static void Check(bool condition, string message) { if (!condition) throw new Exception("PREVIS CHECK: " + message); }
    public static void Run() {try{RunCore();EditorApplication.Exit(0);}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
    public static void RunCore() {
            PrevisValidationChecks.RunCore();
            Check((SpaceMap.Position(SpaceMap.Position(new Vector3(1,2,3))) - new Vector3(1,2,3)).sqrMagnitude < 1e-8f, "position roundtrip");
            var q = Quaternion.Euler(21,42,13);
            Check(Quaternion.Angle(SpaceMap.Rotation(SpaceMap.Rotation(q)),q) < .001f,"rotation roundtrip");
            var p=new Vector3(.3f,.7f,-.9f);
            Check(Vector3.Distance(SpaceMap.Position(q*p),SpaceMap.Rotation(q)*SpaceMap.Position(p))<.0001f,"rotated point agrees across reflection");
            foreach (var data in PrevisFixtures.All()) {
                var runtime = new PrevisScene(); runtime.Load(data);
                var report = runtime.Preflight();
                Check(report.valid, data.id + " valid fixture: " + JsonUtility.ToJson(report));
                var saved = runtime.Capture(); var json = JsonUtility.ToJson(saved);
                runtime.Load(JsonUtility.FromJson<ExchangeScene>(json));
                Check(Vector3.Distance(runtime.Camera.transform.position, SpaceMap.Position(saved.camera.position)) < .0001f, "camera roundtrip");
                Check(Vector3.Dot(runtime.Camera.transform.forward,SpaceMap.Position(saved.camera.target-saved.camera.position).normalized)>.9999f,"camera direction roundtrip");
                var projectedUp=Vector3.ProjectOnPlane(SpaceMap.Position(saved.camera.up),runtime.Camera.transform.forward).normalized;Check(Vector3.Dot(runtime.Camera.transform.up,projectedUp)>.9999f,"camera up roundtrip");
                var subject=Array.Find(saved.entities,e=>e.role=="subject");var joint=subject.joints[3];runtime.Joints[subject.id][joint.id].localRotation=q;
                var edited=runtime.Capture();runtime.Load(JsonUtility.FromJson<ExchangeScene>(JsonUtility.ToJson(edited)));
                Check(Quaternion.Angle(runtime.Joints[subject.id][joint.id].localRotation,q)<.001f,"edited joint rotation roundtrip");
                var child=Array.Find(subject.joints,j=>!string.IsNullOrEmpty(j.parentId));var parent=runtime.Joints[subject.id][child.parentId];parent.localRotation=q;var childWorld=runtime.Joints[subject.id][child.id].position;var hierarchy=runtime.Capture();runtime.Load(JsonUtility.FromJson<ExchangeScene>(JsonUtility.ToJson(hierarchy)));Check(Vector3.Distance(runtime.Joints[subject.id][child.id].position,childWorld)<.0001f,"parent rotation preserves descendant world position on reload");
                runtime.Load(saved);
                var relation = Array.Find(saved.relations,r=>r.kind=="contact");
                runtime.Entities[relation.subjectId].transform.position += Vector3.one;
                Check(!runtime.Preflight().valid, "displaced contact rejected");
                runtime.Dispose();
                var renamed=JsonUtility.FromJson<ExchangeScene>(JsonUtility.ToJson(data));foreach(var entity in renamed.entities)entity.id="renamed-"+entity.id;foreach(var r in renamed.relations){r.subjectId="renamed-"+r.subjectId;r.targetId="renamed-"+r.targetId;}runtime.Load(renamed);Check(runtime.Preflight().valid,"fixture remains valid after all entity IDs renamed");runtime.Dispose();
            }
            var inside = PrevisFixtures.All()[0]; var stage = new PrevisScene(); stage.Load(inside);
            stage.Entities[Array.Find(inside.relations,r=>r.kind=="inside").subjectId].transform.position += new Vector3(5,0,0);
            Check(!stage.Preflight().valid,"outside rejected"); stage.Dispose();
            var away=PrevisFixtures.Table();away.camera.target=away.camera.position+new Vector3(0,0,2);stage.Load(away);
            Check(!stage.Preflight().valid,"required contact outside camera rejected");stage.Dispose();
            stage.Load(PrevisFixtures.Table());stage.Data.camera.target=stage.Data.camera.position+new Vector3(0,0,2);Check(!stage.Preflight().valid,"camera data edits cannot bypass visibility gate");stage.Dispose();
            var original=JsonUtility.ToJson(PrevisFixtures.Table()).Replace("\"schemaVersion\"","\"opaqueNote\":\"preserve-me\",\"schemaVersion\"");stage.LoadJson(original);var savedPath=stage.Save();stage.LoadFile(savedPath);Check(stage.OriginalJson==original,"opaque source survives save/reopen");stage.Dispose();
            var sidecar=Path.Combine(Path.GetDirectoryName(savedPath),"source-input.json");var unrelated=PrevisFixtures.Table();unrelated.source.shotId="other-shot";File.WriteAllText(sidecar,JsonUtility.ToJson(unrelated));
            var lineageRejected=false;try{stage.LoadFile(savedPath);}catch(Exception e){lineageRejected=e.Message.Contains("lineage mismatch");}Check(lineageRejected,"unrelated source sidecar rejected");stage.Dispose();
            Debug.Log("PREVIS_CHECKS_PASS");
    }
}
}
