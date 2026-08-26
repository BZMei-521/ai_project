using System;
using UnityEngine;

namespace StoryboardPrevis {
// Pure validation checks: the aggregate runner owns Unity lifecycle and exit status.
public static class PrevisValidationChecks {
    static EntityData Actor(ExchangeScene s) { return Array.Find(s.entities, e => e.role == "subject"); }
    static void Reject(string name, Action<ExchangeScene> mutate) {
        var scene = PrevisFixtures.Table(); mutate(scene);
        string[] errors;
        try { errors = SpaceMap.Validate(scene); }
        catch (Exception e) { throw new Exception("PREVIS VALIDATION: " + name + " threw instead of returning errors", e); }
        if (errors.Length == 0) throw new Exception("PREVIS VALIDATION: accepted " + name);
    }
    public static void RunCore() {
        foreach (var scene in PrevisFixtures.All())
            if (SpaceMap.Validate(scene).Length != 0) throw new Exception("PREVIS VALIDATION: valid fixture rejected");
        if (SpaceMap.Validate(null).Length == 0) throw new Exception("PREVIS VALIDATION: null scene accepted");
        Reject("missing body mapping", s => Array.Find(Actor(s).joints, j => j.openPoseIndex == 0).openPoseIndex = -1);
        Reject("duplicate body mapping", s => Array.Find(Actor(s).joints, j => j.openPoseIndex == 0).openPoseIndex = 1);
        Reject("out of range body mapping", s => Actor(s).joints[0].openPoseIndex = 18);
        Reject("missing hand mapping", s => Array.Find(Actor(s).joints, j => j.hand == "left" && j.handIndex == 20).handIndex = -1);
        Reject("duplicate hand mapping", s => Array.Find(Actor(s).joints, j => j.hand == "right" && j.handIndex == 20).handIndex = 19);
        Reject("out of range hand mapping", s => Actor(s).joints[0].handIndex = 21);
        Reject("unsupported hand", s => Actor(s).joints[0].hand = "other");
        Reject("empty subject skeleton", s => { Actor(s).joints = Array.Empty<JointData>(); Actor(s).bones = Array.Empty<BoneData>(); Actor(s).attachments = Array.Empty<AttachmentData>(); s.relations = Array.Empty<RelationData>(); });
        Reject("empty scene", s => { s.entities = Array.Empty<EntityData>(); s.relations = Array.Empty<RelationData>(); });
        Reject("missing source", s => s.source = null);
        Reject("missing camera", s => s.camera = null);
        Reject("source id", s => s.source.snapshotId = "");
        Reject("source unsafe id", s => s.source.stageId = "../stage");
        Reject("source digest", s => s.source.stageDigest = new string('g', 64));
        Reject("source revision", s => s.source.stageRevision = -1);
        Reject("scene unsafe id", s => s.id = "a/b");
        Reject("invalid role", s => s.entities[0].role = "unsupported");
        Reject("entity unsafe id", s => s.entities[0].id = "a.b");
        Reject("duplicate entity", s => s.entities[0].id = s.entities[1].id);
        Reject("null entity before relation subject", s => s.entities[0] = null);
        Reject("null part", s => s.entities[0].parts[0] = null);
        Reject("null joint", s => Actor(s).joints[0] = null);
        Reject("null bone", s => Actor(s).bones[0] = null);
        Reject("null attachment", s => Actor(s).attachments[0] = null);
        Reject("null relation", s => s.relations[0] = null);
        Reject("missing parts", s => Actor(s).parts = null);
        Reject("missing joints", s => Actor(s).joints = null);
        Reject("missing bones", s => Actor(s).bones = null);
        Reject("missing attachments used by relation", s => Actor(s).attachments = null);
        Reject("missing entities", s => s.entities = null);
        Reject("missing relations", s => s.relations = null);
        Reject("duplicate part id", s => s.entities[0].parts[1].id = s.entities[0].parts[0].id);
        Reject("duplicate attachment id", s => Actor(s).attachments[1].id = Actor(s).attachments[0].id);
        Reject("unsafe attachment id", s => Actor(s).attachments[1].id = "bad/id");
        Reject("dangling parent", s => Actor(s).joints[0].parentId = "missing");
        Reject("cyclic parents", s => Actor(s).joints[0].parentId = Actor(s).joints[1].id);
        Reject("dangling bone", s => Actor(s).bones[0].to = "missing");
        Reject("self bone", s => Actor(s).bones[0].to = Actor(s).bones[0].from);
        Reject("dangling target", s => s.relations[0].targetId = "missing");
        Reject("nonfinite position", s => Actor(s).position.x = float.NaN);
        Reject("excessive position", s => Actor(s).position.x = float.MaxValue);
        Reject("nonunit quaternion", s => Actor(s).rotation = new Quaternion(0,0,0,2));
        Reject("negative size", s => s.entities[0].parts[0].size.x = -1);
        Reject("excessive scale", s => Actor(s).scale.x = float.MaxValue);
        Reject("excessive radius", s => Actor(s).joints[0].radius = float.MaxValue);
        Reject("excessive tolerance", s => s.relations[0].tolerance = float.MaxValue);
        Reject("bad camera clip", s => s.camera.far = s.camera.near);
        Reject("excessive camera far", s => s.camera.far = float.MaxValue);
        Reject("degenerate camera", s => s.camera.target = s.camera.position);
        Reject("excessive output", s => s.camera.width = 4097);
        Reject("entity count cap", s => s.entities = new EntityData[257]);
        Reject("joint count cap", s => Actor(s).joints = new JointData[1025]);
        Reject("relation count cap", s => s.relations = new RelationData[4097]);
        var noHand = PrevisFixtures.Table();
        foreach(var j in Actor(noHand).joints) if(j.hand == "") j.hand = "none";
        if(SpaceMap.Validate(noHand).Length != 0) throw new Exception("PREVIS VALIDATION: none hand synonym rejected");
        // Non-humanoid geometry is allowed for environment/occluder render checks.
        var geometry = PrevisFixtures.Table();
        geometry.relations = Array.Empty<RelationData>();
        geometry.entities = new[] { geometry.entities[0] };
        if (SpaceMap.Validate(geometry).Length != 0) throw new Exception("PREVIS VALIDATION: geometry-only environment rejected");
        Debug.Log("PREVIS_VALIDATION_CHECKS_PASS");
    }
}
}
