using System;
using System.IO;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;
namespace StoryboardPrevis {
public static class PrevisBatch {
    static string Arg(string name) {
        var args=Environment.GetCommandLineArgs();
        for(var i=0;i<args.Length-1;i++)if(string.Equals(args[i],name,StringComparison.Ordinal))return args[i+1];
        throw new ArgumentException("Missing command-line argument: "+name);
    }
    public static void ExportInputDirectory(){try{
        var inputDir=Path.GetFullPath(Arg("--previs-input-dir"));
        if(!Directory.Exists(inputDir))throw new DirectoryNotFoundException(inputDir);
        var files=Directory.GetFiles(inputDir,"*.unity-exchange.json",SearchOption.TopDirectoryOnly);Array.Sort(files,StringComparer.Ordinal);
        if(files.Length==0)throw new InvalidOperationException("No exchange JSON files in "+inputDir);
        foreach(var input in files)using(var stage=new PrevisScene()){stage.LoadFile(input);var output=PrevisExport.Export(stage);Debug.Log("PREVIS_INPUT_EXPORT="+input+"|"+output);}
        Debug.Log("PREVIS_INPUT_EXPORTS_PASS="+files.Length);EditorApplication.Exit(0);
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
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
