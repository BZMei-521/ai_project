using System;
using System.Collections.Generic;
using UnityEngine;
namespace StoryboardPrevis {
[Serializable] public class ProjectedJoint {public string entityId,jointId,hand;public int bodyIndex,handIndex;public float x,y,eyeDepth;public bool inFrame,occludedByOtherEntity;}
[Serializable] public class ProjectedJoints {public string coordinates="pixels, origin top-left";public string occlusionPolicy="all joints within clip volume are projected; other-entity occlusion annotated, not culled";public ProjectedJoint[] joints;}
public static class PrevisPose {
    static readonly int[,] BodyEdges={{1,2},{2,3},{3,4},{1,5},{5,6},{6,7},{1,8},{8,9},{9,10},{1,11},{11,12},{12,13},{1,0},{0,14},{14,16},{0,15},{15,17}};
    static Color32 Hue(int i,int count){return Color.HSVToRGB((float)i/count,1,1);}
    static bool Pixel(Camera c,Vector3 p,int width,int height,out Vector2 point){var v=c.WorldToViewportPoint(p);point=new Vector2(v.x*width,v.y*height);return v.z>=c.nearClipPlane&&v.z<=c.farClipPlane&&v.x>=0&&v.x<1&&v.y>=0&&v.y<1;}
    static void Dot(Color32[] pixels,int width,int height,Vector2 p,int radius,Color32 color){int cx=Mathf.RoundToInt(p.x),cy=Mathf.RoundToInt(p.y);for(int y=-radius;y<=radius;y++)for(int x=-radius;x<=radius;x++)if(x*x+y*y<=radius*radius){var px=cx+x;var py=cy+y;if(px>=0&&py>=0&&px<width&&py<height)pixels[py*width+px]=color;}}
    static void Line(Color32[] pixels,int w,int h,Vector2 a,Vector2 b,int radius,Color32 color){var steps=Mathf.CeilToInt(Vector2.Distance(a,b));for(int i=0;i<=steps;i++)Dot(pixels,w,h,Vector2.Lerp(a,b,steps==0?0:(float)i/steps),radius,color);}
    public static Texture2D Render(PrevisScene stage,EntityData entity,string channel) {
        int w=stage.Data.camera.width,h=stage.Data.camera.height;var pixels=new Color32[w*h];for(int i=0;i<pixels.Length;i++)pixels[i]=new Color32(0,0,0,255);
        var map=stage.Joints[entity.id];int radius=Mathf.Max(1,h/270);
        Action<string,string,Color32> edge=(a,b,color)=>{if(!map.ContainsKey(a)||!map.ContainsKey(b))return;Vector2 ap,bp;if(Pixel(stage.Camera,map[a].position,w,h,out ap)&&Pixel(stage.Camera,map[b].position,w,h,out bp))Line(pixels,w,h,ap,bp,radius,color);};
        if(channel=="body") {
            for(int i=0;i<BodyEdges.GetLength(0);i++){var a=Array.Find(entity.joints,j=>j.openPoseIndex==BodyEdges[i,0]);var b=Array.Find(entity.joints,j=>j.openPoseIndex==BodyEdges[i,1]);if(a!=null&&b!=null)edge(a.id,b.id,Hue(i,18));}
            foreach(var j in entity.joints)if(j.openPoseIndex>=0){Vector2 p;if(Pixel(stage.Camera,map[j.id].position,w,h,out p))Dot(pixels,w,h,p,radius+1,Hue(j.openPoseIndex,18));}
        } else if(channel=="hands") {
            foreach(var hand in new[]{"right","left"})for(int finger=0;finger<5;finger++)for(int segment=0;segment<4;segment++){
                int aIndex=segment==0?0:1+finger*4+segment-1,bIndex=1+finger*4+segment;var a=Array.Find(entity.joints,j=>j.hand==hand&&j.handIndex==aIndex);var b=Array.Find(entity.joints,j=>j.hand==hand&&j.handIndex==bIndex);if(a!=null&&b!=null)edge(a.id,b.id,Hue(finger,5));
            }
        } else if(channel=="contacts") {
            foreach(var r in stage.Data.relations)if(r.kind=="contact"&&r.subjectId==entity.id){Vector2 a,b;var actual=stage.Attachment(entity.id,r.attachmentId);var target=stage.Entities[r.targetId].transform.TransformPoint(SpaceMap.Position(r.targetPoint));if(Pixel(stage.Camera,actual,w,h,out a)&&Pixel(stage.Camera,target,w,h,out b)){Line(pixels,w,h,a,b,radius,Color.yellow);Dot(pixels,w,h,b,radius+5,Color.cyan);Dot(pixels,w,h,a,radius+2,Color.green);}}
        }
        var result=new Texture2D(w,h,TextureFormat.RGB24,false,true);result.SetPixels32(pixels);result.Apply();return result;
    }
    public static ProjectedJoints Project(PrevisScene stage) {
        var output=new List<ProjectedJoint>();foreach(var e in stage.Data.entities)foreach(var j in e.joints){var world=stage.Joints[e.id][j.id].position;var viewport=stage.Camera.WorldToViewportPoint(world);Vector2 pixel;bool inside=Pixel(stage.Camera,world,stage.Data.camera.width,stage.Data.camera.height,out pixel);bool blocked=false;RaycastHit hit;var direction=world-stage.Camera.transform.position;
            blocked=IsOtherEntityOccluded(stage,e.id,world);
            output.Add(new ProjectedJoint{entityId=e.id,jointId=j.id,hand=j.hand,bodyIndex=j.openPoseIndex,handIndex=j.handIndex,x=pixel.x,y=stage.Data.camera.height-pixel.y,eyeDepth=viewport.z,inFrame=inside,occludedByOtherEntity=blocked});
        }return new ProjectedJoints{joints=output.ToArray()};
    }
    public static bool IsOtherEntityOccluded(PrevisScene stage,string entityId,Vector3 world) {
        var direction=world-stage.Camera.transform.position;if(direction.sqrMagnitude<.000001f)return false;
        foreach(var hit in Physics.RaycastAll(stage.Camera.transform.position,direction.normalized,Mathf.Max(0,direction.magnitude-.025f))) {
            var renderer=hit.collider.GetComponent<Renderer>();string owner;if(renderer!=null&&stage.Renderers.TryGetValue(renderer,out owner)&&owner!=entityId)return true;
        }return false;
    }
}
}
