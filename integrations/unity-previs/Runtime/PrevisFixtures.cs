using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryboardPrevis {
// Fixture data only. Renderer and constraints do not inspect scene IDs.
public static class PrevisFixtures {
    static Vector3 V(float x,float y,float z) {return new Vector3(x,y,z);}
    static PartData Box(string id,Vector3 p,Vector3 size,float r=.36f,float g=.25f,float b=.18f) {return new PartData{id=id,kind="box",position=p,size=size,color=new[]{r,g,b}};}
    static EntityData Entity(string id,string role,params PartData[] parts){return new EntityData{id=id,label=id,role=role,parts=parts};}
    static ExchangeScene Base(string id,string label,ShotCamera camera) {return new ExchangeScene{id=id,label=label,camera=camera,source=new ExchangeSource{stageId=id,stageRevision=1,stageDigest=new string('a',64),shotId=id+"-shot",snapshotId=id+"-snapshot",cameraId=id+"-camera"}};}
    public static ExchangeScene[] All(){return new[]{Container(),Table()};}
    static EntityData Human(bool lying) {
        var joints=new List<JointData>();var bones=new List<BoneData>();var positions=new Dictionary<string,Vector3>();
        Action<string,string,Vector3,int,float> add=(id,parent,p,index,radius)=>{positions.Add(id,p);joints.Add(new JointData{id=id,parentId=parent,position=p-(parent==""?Vector3.zero:positions[parent]),openPoseIndex=index,radius=radius});if(parent!="")bones.Add(new BoneData{from=parent,to=id,radius=radius});};
        add("pelvis","",lying?V(0,.25f,-.25f):V(0,.68f,0),-1,.09f);
        add("chest","pelvis",lying?V(0,.28f,.15f):V(0,1.09f,0),-1,.14f);
        add("neck","chest",lying?V(0,.29f,.44f):V(0,1.34f,0),1,.045f);
        add("head","neck",lying?V(0,.3f,.66f):V(0,1.51f,0),-1,.12f);
        add("nose","head",lying?V(0,.42f,.7f):V(0,1.52f,.12f),0,.022f);
        add("right-eye","head",lying?V(-.045f,.407f,.74f):V(-.045f,1.56f,.105f),14,.014f);
        add("left-eye","head",lying?V(.045f,.407f,.74f):V(.045f,1.56f,.105f),15,.014f);
        add("right-ear","head",lying?V(-.115f,.31f,.69f):V(-.115f,1.52f,0),16,.018f);
        add("left-ear","head",lying?V(.115f,.31f,.69f):V(.115f,1.52f,0),17,.018f);
        for(int side=0;side<2;side++) {
            float sign=side==0?-1:1; string prefix=side==0?"right":"left";int armIndex=side==0?2:5;int legIndex=side==0?8:11;
            add(prefix+"-shoulder","chest",lying?V(sign*.2f,.29f,.32f):V(sign*.2f,1.27f,0),armIndex,.055f);
            add(prefix+"-elbow",prefix+"-shoulder",lying?V(sign*.3f,.54f,.2f):V(sign*.33f,.98f,.22f),armIndex+1,.043f);
            var wrist=lying?V(sign*.22f,.8f,.29f):V(sign*.25f,1f,.5f);
            add(prefix+"-wrist",prefix+"-elbow",wrist,armIndex+2,.023f);
            joints[joints.Count-1].hand=prefix;joints[joints.Count-1].handIndex=0;
            var palm=wrist+(lying?V(0,.07f,0):V(0,0,.05f));
            add(prefix+"-palm",prefix+"-wrist",palm,-1,.029f);
            // Five articulated digit chains: wrist=0, thumb 1..4, index 5..8, etc.
            for(int finger=0;finger<5;finger++) {
                string parent=prefix+"-palm";
                for(int segment=0;segment<4;segment++) {
                    var spread=(finger-2)*.018f;var reach=.026f+segment*.02f;
                    var p=palm+(lying?V(spread,0,reach):V(spread,-segment*.007f,reach));
                    if(finger==0)p=palm+(lying?V(-sign*(.04f+segment*.015f),-.01f,.01f+segment*.012f):V(-sign*(.04f+segment*.015f),-.01f,.01f+segment*.012f));
                    if(!lying&&side==0) {
                        // Four fingers wrap around the near/right cup wall; thumb opposes them.
                        var gripX=new[]{.02f,.05f,.071f,.054f};var gripZ=new[]{.032f,.055f,.095f,.135f};
                        p=palm+V(finger==0?-gripX[segment]:gripX[segment],finger==0?-.025f:(finger-2.5f)*.02f,gripZ[segment]);
                    }
                    var name=prefix+"-finger-"+finger+"-"+segment;add(name,parent,p,-1,.007f);joints[joints.Count-1].hand=prefix;joints[joints.Count-1].handIndex=1+finger*4+segment;parent=name;
                }
            }
            add(prefix+"-hip","pelvis",lying?V(sign*.1f,.25f,-.3f):V(sign*.11f,.68f,0),legIndex,.075f);
            add(prefix+"-knee",prefix+"-hip",lying?V(sign*.11f,.24f,-.7f):V(sign*.13f,.55f,.42f),legIndex+1,.06f);
            add(prefix+"-ankle",prefix+"-knee",lying?V(sign*.11f,.2f,-1.04f):V(sign*.13f,.12f,.44f),legIndex+2,.04f);
            add(prefix+"-foot",prefix+"-ankle",lying?V(sign*.11f,.3f,-1.06f):V(sign*.13f,.075f,.59f),-1,.04f);
        }
        return new EntityData{id="actor",label="Articulated actor",role="subject",joints=joints.ToArray(),bones=bones.ToArray(),attachments=new[]{new AttachmentData{id="right-palm-contact",jointId="right-palm",position=lying?V(0,.03f,0):V(0,0,.029f)},new AttachmentData{id="left-palm-contact",jointId="left-palm",position=lying?V(0,.03f,0):Vector3.zero}}};
    }
    public static ExchangeScene Container() {
        var scene=Base("container","01 / Inside container",new ShotCamera{position=V(.32f,.83f,1.15f),target=V(0,.43f,.12f),up=Vector3.up,fov=82,near=.015f,far=6,width=960,height=540});
        var box=Entity("container","environment",Box("floor",V(0,0,0),V(1.1f,.12f,2.6f)),Box("left-wall",V(-.53f,.49f,0),V(.12f,.86f,2.6f)),Box("right-wall",V(.53f,.49f,0),V(.12f,.86f,2.6f)),Box("head-wall",V(0,.49f,1.25f),V(1.1f,.86f,.12f)),Box("foot-wall",V(0,.49f,-1.25f),V(1.1f,.86f,.12f)));
        var lid=Entity("lid","foreground_occluder",Box("lid-panel",V(0,0,0),V(1.1f,.1f,2.6f),.3f,.2f,.13f));lid.position=V(0,.95f,0);
        scene.entities=new[]{box,lid,Human(true)};
        scene.relations=new[]{new RelationData{kind="inside",subjectId="actor",targetId="container",interiorMin=V(-.47f,.06f,-1.19f),interiorMax=V(.47f,.9f,1.19f),tolerance=.005f},new RelationData{kind="contact",subjectId="actor",targetId="lid",attachmentId="right-palm-contact",targetPoint=V(-.22f,-.05f,.29f),tolerance=.015f},new RelationData{kind="contact",subjectId="actor",targetId="lid",attachmentId="left-palm-contact",targetPoint=V(.22f,-.05f,.29f),tolerance=.015f}};
        return scene;
    }
    public static ExchangeScene Table() {
        var scene=Base("table","02 / Seated with cup",new ShotCamera{position=V(2,1.85f,2.9f),target=V(0,.9f,.22f),up=Vector3.up,fov=48,near=.02f,far=12,width=960,height=540});
        var room=Entity("room","environment",Box("floor",V(0,-.08f,0),V(6,.12f,6),.28f,.32f,.36f),Box("back-wall",V(0,1.4f,-1.2f),V(6,3,.1f),.35f,.4f,.45f));
        var table=Entity("table","foreground_occluder",Box("top",V(0,.84f,.75f),V(1.6f,.09f,.8f),.52f,.35f,.22f),Box("leg-left",V(-.65f,.4f,.75f),V(.1f,.8f,.6f)),Box("leg-right",V(.65f,.4f,.75f),V(.1f,.8f,.6f)));
        var chair=Entity("chair","environment",Box("seat",V(0,.53f,0),V(.55f,.1f,.5f)),Box("back",V(0,.9f,-.25f),V(.55f,.7f,.07f)));
        var cup=Entity("cup","interaction",new PartData{id="cup-body",kind="cylinder",size=V(.13f,.19f,.13f),color=new[]{.2f,.65f,.72f}},Box("handle",V(-.085f,0,0),V(.035f,.085f,.035f),.2f,.65f,.72f));cup.position=V(-.25f,1.02f,.645f);
        scene.entities=new[]{room,table,chair,cup,Human(false)};scene.relations=new[]{new RelationData{kind="contact",subjectId="actor",targetId="cup",attachmentId="right-palm-contact",targetPoint=V(0,-.02f,-.066f),tolerance=.015f}};
        return scene;
    }
}
}
