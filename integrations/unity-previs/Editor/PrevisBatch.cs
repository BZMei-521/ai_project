using System;
using System.IO;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;
namespace StoryboardPrevis {
public static class PrevisBatch {
    public static void VerifyAndBuild(){try{PrevisChecks.RunCore();PrevisRenderChecks.RunCore();foreach(var fixture in PrevisFixtures.All())using(var stage=new PrevisScene()){stage.Load(fixture);Debug.Log("PREVIS_EDITOR_EXPORT="+PrevisExport.Export(stage));}Build();}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
    public static void ExportFixtures(){try{foreach(var fixture in PrevisFixtures.All())using(var stage=new PrevisScene()){stage.Load(fixture);var dir=PrevisExport.Export(stage);Debug.Log("PREVIS_EDITOR_EXPORT="+dir);}Debug.Log("PREVIS_EXPORTS_PASS");EditorApplication.Exit(0);}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
    public static void Build(){try{
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);new GameObject("Previs Application").AddComponent<PrevisApp>();EditorSceneManager.SaveScene(scene,"Assets/Previs/Previs.unity");
        PlayerSettings.productName="Storyboard Unity Previs";PlayerSettings.companyName="Local Prototype";PlayerSettings.defaultScreenWidth=1440;PlayerSettings.defaultScreenHeight=900;PlayerSettings.fullScreenMode=FullScreenMode.Windowed;PlayerSettings.resizableWindow=true;PlayerSettings.runInBackground=true;PlayerSettings.colorSpace=ColorSpace.Gamma;PlayerSettings.SetScriptingBackend(BuildTargetGroup.Standalone,ScriptingImplementation.Mono2x);
        Directory.CreateDirectory(Path.Combine(PrevisPaths.ProjectRoot,"Builds"));var path=Path.Combine(PrevisPaths.ProjectRoot,"Builds","StoryboardPrevis.exe");
        var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Previs/Previs.unity"},locationPathName=path,target=BuildTarget.StandaloneWindows64,options=BuildOptions.Development});
        if(report.summary.result!=BuildResult.Succeeded)throw new Exception("Build failed: "+report.summary.result);Debug.Log("PREVIS_BUILD_PASS="+path);EditorApplication.Exit(0);
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
}
