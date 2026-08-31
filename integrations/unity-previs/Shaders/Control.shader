Shader "Hidden/Previs/Control" {
 Properties { _Color("Color", Color)=(.6,.7,.8,1) _MaskValue("Mask",Float)=0 _UsePanorama("Use Panorama",Float)=0 _PanoramaTex("Panorama",2D)="black"{} _PanoramaAnchor("Panorama Anchor",Vector)=(0,0,0,0) _PanoramaYaw("Panorama Yaw",Float)=0 }
 SubShader { Tags {"RenderType"="Opaque"} Pass {
  Cull Back ZWrite On ZTest LEqual
  CGPROGRAM
  #pragma vertex vert
  #pragma fragment frag
  #include "UnityCG.cginc"
  sampler2D _PanoramaTex; float4 _Color; float4 _PanoramaAnchor; float _MaskValue; float _UsePanorama; float _PanoramaYaw; float _PrevisMode; float _PrevisNear; float _PrevisFar;
  struct v2f { float4 pos:SV_POSITION; float3 normal:TEXCOORD0; float eye:TEXCOORD1; float3 worldNormal:TEXCOORD2; float3 worldPos:TEXCOORD3; };
  v2f vert(appdata_base v) {v2f o;o.pos=UnityObjectToClipPos(v.vertex);o.worldPos=mul(unity_ObjectToWorld,v.vertex).xyz;o.worldNormal=UnityObjectToWorldNormal(v.normal);o.normal=mul((float3x3)UNITY_MATRIX_V,o.worldNormal);o.eye=-UnityObjectToViewPos(v.vertex).z;return o;}
  float4 frag(v2f i):SV_Target {
   if(_PrevisMode>2.5) return float4(_MaskValue.xxx,1);
   if(_PrevisMode>1.5) return float4(normalize(i.normal)*.5+.5,1);
   if(_PrevisMode>.5) {float d=1-saturate((i.eye-_PrevisNear)/(_PrevisFar-_PrevisNear));return float4(d,d,d,1);}
   float shade=.38+.62*max(0,dot(normalize(i.worldNormal),normalize(float3(.4,1,-.35))));
   if(_UsePanorama>.5) {float3 d=normalize(i.worldPos-_PanoramaAnchor.xyz);float c=cos(_PanoramaYaw),s=sin(_PanoramaYaw);d=float3(c*d.x-s*d.z,d.y,s*d.x+c*d.z);float2 uv=float2(atan2(d.x,-d.z)/(6.28318530718)+.5,asin(clamp(d.y,-1,1))/3.14159265359+.5);return float4(tex2D(_PanoramaTex,uv).rgb*shade,1);}
   return float4(_Color.rgb*shade,1);
  }
  ENDCG
 } }
}
