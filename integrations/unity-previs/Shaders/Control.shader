Shader "Hidden/Previs/Control" {
 Properties { _Color("Color", Color)=(.6,.7,.8,1) _MaskValue("Mask",Float)=0 }
 SubShader { Tags {"RenderType"="Opaque"} Pass {
  Cull Back ZWrite On ZTest LEqual
  CGPROGRAM
  #pragma vertex vert
  #pragma fragment frag
  #include "UnityCG.cginc"
  float4 _Color; float _MaskValue; float _PrevisMode; float _PrevisNear; float _PrevisFar;
  struct v2f { float4 pos:SV_POSITION; float3 normal:TEXCOORD0; float eye:TEXCOORD1; float3 worldNormal:TEXCOORD2; };
  v2f vert(appdata_base v) {v2f o;o.pos=UnityObjectToClipPos(v.vertex);o.worldNormal=UnityObjectToWorldNormal(v.normal);o.normal=mul((float3x3)UNITY_MATRIX_V,o.worldNormal);o.eye=-UnityObjectToViewPos(v.vertex).z;return o;}
  float4 frag(v2f i):SV_Target {
   if(_PrevisMode>2.5) return float4(_MaskValue.xxx,1);
   if(_PrevisMode>1.5) return float4(normalize(i.normal)*.5+.5,1);
   if(_PrevisMode>.5) {float d=1-saturate((i.eye-_PrevisNear)/(_PrevisFar-_PrevisNear));return float4(d,d,d,1);}
   float shade=.38+.62*max(0,dot(normalize(i.worldNormal),normalize(float3(.4,1,-.35))));return float4(_Color.rgb*shade,1);
  }
  ENDCG
 } }
}
