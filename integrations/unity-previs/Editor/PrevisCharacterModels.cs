using System;
using UnityEditor;
using UnityEngine;

namespace StoryboardPrevis {
public static class PrevisCharacterModels {
    const string LiPath="Assets/Previs/Models/li-baozhu-female-rigify-supine-v1.fbx";
    const string WeiPath="Assets/Previs/Models/wei-xun-male-rigify-relaxed-v1.fbx";
    static GameObject Instance(string path) {
        var prefab=AssetDatabase.LoadAssetAtPath<GameObject>(path);if(prefab==null)throw new Exception("approved character model missing: "+path);
        var instance=UnityEngine.Object.Instantiate(prefab);instance.hideFlags=HideFlags.DontSave;return instance;
    }
    public static void AttachApproved(PrevisScene stage) {
        stage.ReplaceEntityVisual("li-baozhu-full-body",Instance(LiPath),new Vector3(0,-.89f,0),Quaternion.Euler(0,90,0),new Color(.68f,.52f,.72f,1),.01f);
        stage.ReplaceEntityVisual("wei-xun-full-body",Instance(WeiPath),new Vector3(0,-.9325f,0),Quaternion.identity,new Color(.25f,.45f,.68f,1),.01f);
        foreach(var id in new[]{"li-baozhu-full-body","wei-xun-full-body"}) {var bounds=new Bounds();var initialized=false;foreach(var renderer in stage.Renderers)if(renderer.Value==id){var geometry=stage.GeometryBounds(renderer.Key);if(!initialized){bounds=geometry;initialized=true;}else bounds.Encapsulate(geometry);}Debug.Log("PREVIS_CHARACTER_MODEL="+id+"|"+bounds.size.ToString("F4"));}
    }
}
}
