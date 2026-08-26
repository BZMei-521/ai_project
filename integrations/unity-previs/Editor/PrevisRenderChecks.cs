using System;
using UnityEngine;
using UnityEditor;
namespace StoryboardPrevis {
public static class PrevisRenderChecks {
    static void Check(bool ok,string text){if(!ok)throw new Exception("PREVIS_RENDER_CHECK: "+text);}
    public static void Run(){try{RunCore();EditorApplication.Exit(0);}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
    public static void RunCore(){
        var data=PrevisFixtures.Table(); data.camera=new ShotCamera{position=new Vector3(0,0,3),target=Vector3.zero,up=Vector3.up,fov=50,near=.1f,far=10,width=128,height=128};data.relations=Array.Empty<RelationData>();
        data.entities=new[]{new EntityData{id="back",role="environment",parts=new[]{new PartData{id="back-box",kind="box",size=new Vector3(1.5f,1.5f,.1f)}}},new EntityData{id="front",role="environment",position=new Vector3(0,0,1),parts=new[]{new PartData{id="front-box",kind="box",size=new Vector3(.5f,.5f,.1f)}}}};
        data.entities[0].label="Back";data.entities[1].label="Front";data.entities[0].parts[0].color=new[]{0f,0f,1f};data.entities[1].parts[0].color=new[]{1f,0f,0f};
        using(var stage=new PrevisScene()) {stage.Load(data);
            var visible=PrevisExport.Render(stage,"visible_mask","back");var isolated=PrevisExport.Render(stage,"isolated_mask","back");
            Check(visible.GetPixel(64,64).r<.01f,"front object must occlude back mask");Check(isolated.GetPixel(64,64).r>.99f,"isolated mask retains hidden surface");
            var depth=PrevisExport.Render(stage,"depth","");Check(depth.GetPixel(64,64).r>depth.GetPixel(45,64).r,"near surface brighter than far");
            var normal=PrevisExport.Render(stage,"normal","");var n=normal.GetPixel(64,64);Check(Mathf.Abs(n.r-.5f)<.01f&&Mathf.Abs(n.g-.5f)<.01f&&n.b>.99f,"front-facing surface encodes positive RH view Z");UnityEngine.Object.DestroyImmediate(normal);
            var backColor=PrevisExport.Render(stage,"isolated_color","back");Check(backColor.GetPixel(64,64).b>.1f&&backColor.GetPixel(64,64).r<.01f,"isolated layer color cannot contain another entity");UnityEngine.Object.DestroyImmediate(backColor);
            UnityEngine.Object.DestroyImmediate(visible);UnityEngine.Object.DestroyImmediate(isolated);UnityEngine.Object.DestroyImmediate(depth);
            data.entities[0].parts=new[]{data.entities[0].parts[0],new PartData{id="own-near",kind="box",position=new Vector3(0,0,1.7f),size=new Vector3(.2f,.2f,.1f)}};stage.Load(data);
            Check(PrevisPose.IsOtherEntityOccluded(stage,"back",Vector3.zero),"near own surface cannot hide farther external occluder metadata");
        }
        Debug.Log("PREVIS_RENDER_CHECKS_PASS");
    }
}
}
