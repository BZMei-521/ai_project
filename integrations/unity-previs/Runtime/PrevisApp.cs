using System;
using System.IO;
using System.Collections;
using UnityEngine;
namespace StoryboardPrevis {
public class PrevisApp : MonoBehaviour {
    PrevisScene stage; Texture2D preview; string status="",loadPath=""; int sceneIndex,entityIndex,jointIndex; bool dirty=true;float nextFrame;Vector2 scroll;Font font;GUIStyle title,small;
    IEnumerator Start(){Application.targetFrameRate=30;font=Font.CreateDynamicFontFromOSFont("Microsoft YaHei",16);Switch(0);yield return null;
        if(Array.IndexOf(Environment.GetCommandLineArgs(),"--previs-smoke")>=0){try{foreach(var fixture in PrevisFixtures.All()){stage.Load(fixture);var path=PrevisExport.Export(stage);Debug.Log("PREVIS_PLAYER_EXPORT="+path);}Debug.Log("PREVIS_PLAYER_SMOKE_PASS");Application.Quit(0);}catch(Exception e){Debug.LogException(e);Application.Quit(1);}}
    }
    void Switch(int index){try{if(stage==null)stage=new PrevisScene();stage.Load(PrevisFixtures.All()[index]);sceneIndex=index;entityIndex=jointIndex=0;dirty=true;status="灰模试验：没有调用 AI，也没有修改正式项目。";}catch(Exception e){status=e.Message;}}
    void Update(){if(stage==null)return;if(dirty&&Time.unscaledTime>=nextFrame){try{if(preview!=null)Destroy(preview);preview=PrevisExport.Render(stage,"color","");dirty=false;nextFrame=Time.unscaledTime+.05f;}catch(Exception e){status=e.Message;dirty=false;}}}
    Vector3 Slider3(string label,Vector3 value,float min,float max){GUILayout.Label(label);value.x=Axis("X",value.x,min,max);value.y=Axis("Y",value.y,min,max);value.z=Axis("Z",value.z,min,max);return value;}
    float Axis(string name,float value,float min,float max){GUILayout.BeginHorizontal();GUILayout.Label(name,GUILayout.Width(40));float result=GUILayout.HorizontalSlider(value,min,max);GUILayout.Label(result.ToString("0.00"),GUILayout.Width(45));GUILayout.EndHorizontal();return result;}
    static Vector3 SignedEuler(Vector3 e){return new Vector3(Mathf.DeltaAngle(0,e.x),Mathf.DeltaAngle(0,e.y),Mathf.DeltaAngle(0,e.z));}
    void OnGUI(){if(stage==null)return;GUI.skin.font=font;GUI.skin.label.wordWrap=true;if(title==null){title=new GUIStyle(GUI.skin.label){fontSize=24,fontStyle=FontStyle.Bold};small=new GUIStyle(GUI.skin.label){fontSize=12,wordWrap=true};}
        GUI.backgroundColor=new Color(.25f,.34f,.43f);GUI.Box(new Rect(0,0,Screen.width,Screen.height),GUIContent.none);
        GUILayout.BeginArea(new Rect(18,12,306,Screen.height-24));GUILayout.Label("UNITY / 空间预演",title);GUILayout.Label("独立试验分支 · 灰模与控制图",small);GUILayout.Space(8);
        GUILayout.BeginHorizontal();if(GUILayout.Button("容器内撑掌"))Switch(0);if(GUILayout.Button("桌后持杯"))Switch(1);GUILayout.EndHorizontal();
        scroll=GUILayout.BeginScrollView(scroll);GUILayout.Space(8);GUILayout.Label("实体");var labels=Array.ConvertAll(stage.Data.entities,e=>e.label??e.id);var selected=GUILayout.SelectionGrid(entityIndex,labels,1);if(selected!=entityIndex){entityIndex=selected;jointIndex=0;}
        var entity=stage.Data.entities[entityIndex];var transform=stage.Entities[entity.id].transform;
        GUI.changed=false;var p=Slider3("根位置 / 米",SpaceMap.Position(transform.localPosition),-3,3);var rotation=Slider3("根旋转 / 度",SignedEuler(SpaceMap.Rotation(transform.localRotation).eulerAngles),-180,180);
        if(GUI.changed){transform.localPosition=SpaceMap.Position(p);transform.localRotation=SpaceMap.Rotation(Quaternion.Euler(rotation));dirty=true;}
        if(entity.joints.Length>0){GUILayout.Space(8);GUILayout.Label("关节 / "+entity.joints[jointIndex].id);GUILayout.BeginHorizontal();if(GUILayout.Button("上一关节"))jointIndex=(jointIndex+entity.joints.Length-1)%entity.joints.Length;if(GUILayout.Button("下一关节"))jointIndex=(jointIndex+1)%entity.joints.Length;GUILayout.EndHorizontal();var jt=stage.Joints[entity.id][entity.joints[jointIndex].id];GUI.changed=false;var angles=Slider3("关节局部旋转",SignedEuler(SpaceMap.Rotation(jt.localRotation).eulerAngles),-180,180);if(GUI.changed){jt.localRotation=SpaceMap.Rotation(Quaternion.Euler(angles));dirty=true;}}
        GUILayout.Space(12);GUILayout.Label("镜头相机");var c=stage.Data.camera;GUI.changed=false;var cp=Slider3("位置",c.position,-4,4);var ct=Slider3("目标",c.target,-3,3);var fov=Axis("FOV",c.fov,25,100);if(GUI.changed){if(Vector3.Cross(ct-cp,c.up).sqrMagnitude>.0001f){c.position=cp;c.target=ct;c.fov=fov;stage.ApplyCamera();dirty=true;}}
        GUILayout.Space(12);if(GUILayout.Button("检查空间与接触")){try{var report=stage.Preflight();status=report.valid?"预检通过。仍需人工审核画面、手指与遮挡。":"预检失败："+string.Join(", ",report.errors);}catch(Exception e){status=e.Message;}}
        foreach(var relation in stage.Data.relations)if(relation.kind=="contact"&&relation.subjectId==entity.id){GUILayout.Label("接触 / "+relation.attachmentId+" → "+relation.targetId,small);GUI.changed=false;var point=Slider3("目标局部接触点 / 米",relation.targetPoint,-1.5f,1.5f);var tolerance=Axis("容差",relation.tolerance,.001f,.1f);if(GUI.changed){relation.targetPoint=point;relation.tolerance=tolerance;dirty=true;}}
        if(GUILayout.Button("保存新版本 JSON")){try{loadPath=stage.Save();status="已保存："+loadPath;}catch(Exception e){status=e.Message;}}
        GUILayout.Label("载入交换 JSON（保留原始输入）",small);loadPath=GUILayout.TextField(loadPath);if(GUILayout.Button("读取 JSON")){try{stage.LoadFile(loadPath);entityIndex=jointIndex=0;dirty=true;status="载入成功。";}catch(Exception e){status="载入失败："+e.Message;}}
        if(GUILayout.Button("导出控制图 / 新目录",GUILayout.Height(34))){try{status="已导出："+PrevisExport.Export(stage);}catch(Exception e){status="导出停止："+e.Message;}}
        if(GUILayout.Button("重置当前试验场景"))Switch(sceneIndex);GUILayout.EndScrollView();GUILayout.EndArea();
        float left=346,w=Mathf.Max(100,Screen.width-left-20);GUILayout.BeginArea(new Rect(left,16,w,60));GUILayout.Label(stage.Data.label,title);GUILayout.Label("同一镜头相机 · 完整几何遮挡 · 不隐藏顶盖",small);GUILayout.EndArea();
        if(preview!=null)GUI.DrawTexture(new Rect(left,84,w,Mathf.Max(100,Screen.height-214)),preview,ScaleMode.ScaleToFit,false);
        GUILayout.BeginArea(new Rect(left,Screen.height-118,w,104));GUILayout.Label(status);GUILayout.Label("鼠标调节左侧参数；任何改动需重新导出。自动检查不等于人物身份或 AI 成图通过。",small);GUILayout.EndArea();
    }
    void OnDestroy(){stage?.Dispose();if(preview!=null)Destroy(preview);if(font!=null)Destroy(font);}
}
}
