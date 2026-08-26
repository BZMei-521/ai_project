using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Collections.Generic;
using UnityEngine;

namespace StoryboardPrevis {
[Serializable] public class ExportArtifact {public string kind,entityId,filePath,sha256,encoding;public int width,height;}
[Serializable] public class ExportManifest {public int schemaVersion=1;public string sceneFile="scene.json",sceneSha256,preflightFile="preflight.json";public ExportArtifact[] artifacts;}
public static class PrevisPaths {
    public static string ProjectRoot {get {return Path.GetFullPath(Path.Combine(Application.dataPath,Application.isEditor?"..":"../.."));}}
    public static string OutputRoot {get {return Path.Combine(ProjectRoot,"Exports");}}
    public static string NewRun(string prefix){var folder=Path.Combine(OutputRoot,prefix+"-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff")+"-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(folder);return folder;}
}
public static class PrevisExport {
    public static readonly UTF8Encoding Utf8=new UTF8Encoding(false);
    public static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    public static void Json(string path,object value){File.WriteAllText(path,JsonUtility.ToJson(value,true),Utf8);}
    public static Texture2D Render(PrevisScene stage,string kind,string entityId) {
        stage.UpdateGeometry();stage.ApplyCamera();var c=stage.Data.camera;
        bool isolated=kind.StartsWith("isolated_",StringComparison.Ordinal);var pass=isolated?kind.Substring(9):kind;
        var mode=pass=="depth"?1:pass=="normal"?2:pass=="visible_mask"||pass=="mask"?3:0;
        var oldMode=Shader.GetGlobalFloat("_PrevisMode");var oldActive=RenderTexture.active;var oldTarget=stage.Camera.targetTexture;var oldBackground=stage.Camera.backgroundColor;
        var enabled=new Dictionary<Renderer,bool>();var oldMasks=new Dictionary<Material,float>();
        var rt=new RenderTexture(c.width,c.height,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear){antiAliasing=1};
        Texture2D image=null;
        try {
            Shader.SetGlobalFloat("_PrevisMode",mode);Shader.SetGlobalFloat("_PrevisNear",c.near);Shader.SetGlobalFloat("_PrevisFar",c.far);
            foreach(var kv in stage.Renderers) {enabled.Add(kv.Key,kv.Key.enabled);var mat=kv.Key.sharedMaterial;oldMasks[mat]=mat.GetFloat("_MaskValue");mat.SetFloat("_MaskValue",kv.Value==entityId?1:0);if(isolated)kv.Key.enabled=kv.Value==entityId;}
            stage.Camera.backgroundColor=mode==0&&!isolated?new Color(.055f,.07f,.09f):Color.black;stage.Camera.targetTexture=rt;stage.Camera.Render();RenderTexture.active=rt;
            image=new Texture2D(c.width,c.height,TextureFormat.RGB24,false,true);image.ReadPixels(new Rect(0,0,c.width,c.height),0,0);image.Apply();return image;
        } catch {if(image!=null)UnityEngine.Object.DestroyImmediate(image);throw;}
        finally {stage.Camera.targetTexture=oldTarget;stage.Camera.backgroundColor=oldBackground;RenderTexture.active=oldActive;Shader.SetGlobalFloat("_PrevisMode",oldMode);foreach(var kv in enabled)kv.Key.enabled=kv.Value;foreach(var kv in oldMasks)kv.Key.SetFloat("_MaskValue",kv.Value);rt.Release();UnityEngine.Object.DestroyImmediate(rt);}
    }
    public static string Export(PrevisScene stage) {
        var report=stage.Preflight();if(!report.valid)throw new Exception("Preflight failed: "+string.Join(", ",report.errors));
        var dir=PrevisPaths.NewRun("run");var data=stage.Capture();var scenePath=Path.Combine(dir,"scene.json");Json(scenePath,data);Json(Path.Combine(dir,"preflight.json"),report);
        if(!string.IsNullOrEmpty(stage.OriginalJson))File.WriteAllText(Path.Combine(dir,"source-input.json"),stage.OriginalJson,Utf8);
        var artifacts=new List<ExportArtifact>();var index=0;
        Action<string,string,string,Texture2D> write=(kind,id,encoding,img)=>{try{var name=(index++).ToString("D3")+"-"+kind+".png";var bytes=img.EncodeToPNG();File.WriteAllBytes(Path.Combine(dir,name),bytes);artifacts.Add(new ExportArtifact{kind=kind,entityId=id,filePath=name,width=img.width,height=img.height,sha256=Hash(bytes),encoding=encoding});}finally{UnityEngine.Object.DestroyImmediate(img);}};
        write("color","","srgb_rgb8",Render(stage,"color",""));write("depth","","linear_eye_near_white_8bit",Render(stage,"depth",""));write("normal","","rh_view_normal_rgb8",Render(stage,"normal",""));
        foreach(var entity in data.entities) {
            write("color",entity.id,"srgb_rgb8",Render(stage,"isolated_color",entity.id));
            write("depth",entity.id,"linear_eye_near_white_8bit",Render(stage,"isolated_depth",entity.id));
            write("normal",entity.id,"rh_view_normal_rgb8",Render(stage,"isolated_normal",entity.id));
            write("visible_mask",entity.id,"binary_visible_8bit",Render(stage,"visible_mask",entity.id));
            if(entity.role=="subject") {
                write("isolated_mask",entity.id,"binary_isolated_8bit",Render(stage,"isolated_mask",entity.id));
                write("openpose",entity.id,"openpose_body18_rgb8",PrevisPose.Render(stage,entity,"body"));
                write("hand_pose",entity.id,"openpose_hand21_rgb8",PrevisPose.Render(stage,entity,"hands"));
                write("contact_map",entity.id,"contact_diagnostic_rgb8",PrevisPose.Render(stage,entity,"contacts"));
            }
        }
        Json(Path.Combine(dir,"projected-joints.json"),PrevisPose.Project(stage));
        Json(Path.Combine(dir,"manifest.json"),new ExportManifest{sceneSha256=Hash(File.ReadAllBytes(scenePath)),artifacts=artifacts.ToArray()});
        return dir;
    }
}
}
