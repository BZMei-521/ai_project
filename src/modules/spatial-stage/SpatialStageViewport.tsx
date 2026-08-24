import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { loadStageMesh } from "./importedMesh";
import { createStageOverrideMaterial, renderStagePasses, type StageRenderPassRequest } from "./stageRenderPasses";
import type { StageRenderArtifact, StageRenderKind } from "./spatialControlPack";
import { ThreeResourceTracker } from "./threeResourceTracker";
import type { SceneStage, StageCamera, StageEntity, Transform3D } from "./types";

const MAX_PANORAMA_TEXTURE_WIDTH = 4096;

export type SpatialStageViewportHandle = {
  releaseGpuResources(): void;
  renderControlArtifacts(request: Omit<StageRenderPassRequest, "render">): Promise<StageRenderArtifact[]>;
};

export type SpatialStageViewportProps = {
  stage: SceneStage;
  panoramaUrl?: string;
  selectedEntityId?: string;
  activeCameraId?: string;
  interactionMode: "orbit" | "camera" | "transform";
  overlayMode: "color" | "depth" | "normal" | "entity_id" | "pose";
  paused: boolean;
  onEntityTransformChange(entityId: string, transform: Transform3D): void;
  onCameraChange(camera: StageCamera): void;
  onContextStatusChange(status: "ready" | "lost" | "failed"): void;
};

function makeProxyGeometry(kind: string, size: readonly [number, number, number]): THREE.BufferGeometry {
  switch (kind) {
    case "sphere": return new THREE.SphereGeometry(Math.max(size[0], 0.01), 16, 12);
    case "capsule": return new THREE.CapsuleGeometry(Math.max(size[0], 0.01), Math.max(size[1], 0.01), 8, 16);
    case "plane": return new THREE.PlaneGeometry(Math.max(size[0], 0.01), Math.max(size[2], 0.01));
    default: return new THREE.BoxGeometry(Math.max(size[0], 0.01), Math.max(size[1], 0.01), Math.max(size[2], 0.01));
  }
}

function entityColor(entity: StageEntity, selected: boolean, overlayMode: SpatialStageViewportProps["overlayMode"]): number {
  if (selected) return 0xf2b84b;
  if (overlayMode === "normal") return 0x7f7fff;
  if (overlayMode === "depth") return 0xb8c8d8;
  if (overlayMode === "entity_id") {
    let hash = 0;
    for (const character of entity.id) hash = Math.imul(hash ^ character.charCodeAt(0), 0x45d9f3b);
    return (hash >>> 0) & 0xffffff;
  }
  return 0x5b9bd5;
}

function applyEntityTransform(object: THREE.Object3D, transform: Transform3D): void {
  object.position.set(...transform.position);
  object.quaternion.set(...transform.rotation);
  object.scale.set(...transform.scale);
}

function readEntityTransform(object: THREE.Object3D): Transform3D {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    scale: [object.scale.x, object.scale.y, object.scale.z]
  };
}

function createSavedCamera(camera: StageCamera, aspect: number): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(camera.fov, aspect, camera.near, camera.far);
  result.position.set(...camera.position);
  result.quaternion.set(...camera.rotation);
  result.updateProjectionMatrix();
  return result;
}

export const SpatialStageViewport = forwardRef<SpatialStageViewportHandle, SpatialStageViewportProps>(
  function SpatialStageViewport({
    stage, panoramaUrl, selectedEntityId, activeCameraId, interactionMode, overlayMode, paused,
    onEntityTransformChange, onCameraChange, onContextStatusChange
  }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const releaseRef = useRef<(() => void) | null>(null);
    const renderPassesRef = useRef<((request: Omit<StageRenderPassRequest, "render">) => Promise<StageRenderArtifact[]>) | null>(null);

    useImperativeHandle(ref, () => ({
      releaseGpuResources: () => releaseRef.current?.(),
      renderControlArtifacts: (request) => {
        if (!renderPassesRef.current) return Promise.reject(new Error("spatial_render_viewport_unavailable"));
        return renderPassesRef.current(request);
      }
    }), []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const tracker = new ThreeResourceTracker();
      let released = false;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        onContextStatusChange("failed");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x0b1220, 1);
      renderer.shadowMap.enabled = true;
      host.replaceChildren(renderer.domElement);

      const scene = new THREE.Scene();
      const debugCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
      debugCamera.position.set(0, 1.6, 4);
      debugCamera.lookAt(0, 1, 0);
      const savedCameraDefinition = stage.cameras.find((item) => item.id === activeCameraId);
      const savedCamera = savedCameraDefinition ? createSavedCamera(savedCameraDefinition, 1) : undefined;
      const camera = interactionMode === "orbit" ? debugCamera : savedCamera ?? debugCamera;

      scene.add(new THREE.HemisphereLight(0xffffff, 0x24324a, 1.4));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(4, 8, 5);
      keyLight.castShadow = true;
      scene.add(keyLight);

      const grid = new THREE.GridHelper(20, 20, 0x52708f, 0x20324c);
      tracker.track(grid.geometry);
      if (Array.isArray(grid.material)) grid.material.forEach((material) => tracker.track(material));
      else tracker.track(grid.material);
      scene.add(grid);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ color: 0x172235, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      );
      tracker.trackObject3D(ground);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      const panoramaSphere = new THREE.Mesh(
        new THREE.SphereGeometry(40, 48, 24),
        new THREE.MeshBasicMaterial({ color: 0x2b3b54, side: THREE.BackSide })
      );
      tracker.trackObject3D(panoramaSphere);
      if (panoramaUrl) {
        new THREE.TextureLoader().load(panoramaUrl, (texture) => {
          if (released) { texture.dispose(); return; }
          if (texture.image?.width > MAX_PANORAMA_TEXTURE_WIDTH) { texture.dispose(); return; }
          tracker.track(texture);
          const material = panoramaSphere.material as THREE.MeshBasicMaterial;
          material.map = texture;
          material.needsUpdate = true;
        });
      }
      scene.add(panoramaSphere);

      const depthSource = stage.environment.sources.find((source) => source.kind === "depth_map");
      if (depthSource) {
        new THREE.TextureLoader().load(depthSource.depthUrl, (depthTexture) => {
          if (released) { depthTexture.dispose(); return; }
          depthTexture.colorSpace = THREE.NoColorSpace;
          const surface = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 4 * depthSource.height / depthSource.width, 128, 72),
            new THREE.MeshStandardMaterial({ color: 0xb8c8d8, displacementMap: depthTexture, displacementScale: 1.1, displacementBias: -0.55, side: THREE.DoubleSide, roughness: 0.9 })
          );
          tracker.track(depthTexture);
          tracker.trackObject3D(surface);
          surface.position.set(0, 1.2, -1.5);
          scene.add(surface);
        });
      }

      const entityObjects = new Map<string, THREE.Object3D>();
      const transformControls = new TransformControls(camera, renderer.domElement);
      scene.add(transformControls.getHelper());
      const attachSelected = (entityId: string, object: THREE.Object3D) => {
        if (entityId === selectedEntityId && interactionMode === "transform") transformControls.attach(object);
      };
      for (const entity of stage.entities) {
        if (entity.geometry.kind === "imported_mesh") {
          const resource = entity.geometry.resource;
          loadStageMesh(resource, new GLTFLoader()).then((group) => {
            if (released) { const lateTracker = new ThreeResourceTracker(); lateTracker.trackObject3D(group); lateTracker.dispose(); return; }
            group.name = entity.id;
            group.userData.stageEntityId = entity.id;
            applyEntityTransform(group, entity.transform);
            group.visible = entity.visibility === "visible";
            tracker.trackObject3D(group);
            entityObjects.set(entity.id, group);
            scene.add(group);
            attachSelected(entity.id, group);
          }).catch((error) => {
            if (released) return;
            const geometry = makeProxyGeometry("box", resource.bounds);
            const material = new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true });
            const fallback = new THREE.Mesh(geometry, material);
            fallback.userData.stageEntityId = entity.id;
            fallback.userData.stageMeshError = error instanceof Error ? error.message : String(error);
            applyEntityTransform(fallback, entity.transform);
            tracker.trackObject3D(fallback);
            entityObjects.set(entity.id, fallback);
            scene.add(fallback);
            attachSelected(entity.id, fallback);
          });
          continue;
        }
        const mesh = new THREE.Mesh(
          makeProxyGeometry(entity.geometry.kind, entity.geometry.size),
          new THREE.MeshStandardMaterial({ color: entityColor(entity, entity.id === selectedEntityId, overlayMode), roughness: 0.72, metalness: 0.05 })
        );
        mesh.name = entity.id;
        mesh.userData.stageEntityId = entity.id;
        applyEntityTransform(mesh, entity.transform);
        mesh.visible = entity.visibility === "visible";
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        tracker.trackObject3D(mesh);
        entityObjects.set(entity.id, mesh);
        scene.add(mesh);
        attachSelected(entity.id, mesh);
      }

      const canvasPngBytes = () => new Promise<Uint8Array>((resolve, reject) => {
        renderer.domElement.toBlob((blob) => {
          if (!blob) { reject(new Error("spatial_render_canvas_export_failed")); return; }
          blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
        }, "image/png");
      });
      const renderPass = async (kind: StageRenderKind): Promise<Uint8Array> => {
        const originalBackground = scene.background;
        const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        const overrideMaterials: THREE.Material[] = [];
        if (kind !== "color") {
          scene.background = new THREE.Color(0x000000);
          for (const entity of stage.entities) {
            const object = entityObjects.get(entity.id);
            object?.traverse((child) => {
              if (!(child instanceof THREE.Mesh)) return;
              const material = createStageOverrideMaterial(kind, entity);
              if (!material) return;
              originalMaterials.set(child, child.material);
              overrideMaterials.push(material);
              child.material = material;
            });
          }
        }
        renderer.render(scene, camera);
        const pngBytes = await canvasPngBytes();
        for (const [mesh, material] of originalMaterials) mesh.material = material;
        for (const material of overrideMaterials) material.dispose();
        scene.background = originalBackground;
        return pngBytes;
      };
      renderPassesRef.current = async (request) => {
        const previousSize = renderer.getSize(new THREE.Vector2());
        renderer.setSize(request.width, request.height, false);
        camera.aspect = request.width / request.height;
        camera.updateProjectionMatrix();
        try {
          return await renderStagePasses({ ...request, render: renderPass });
        } finally {
          renderer.setSize(previousSize.x, previousSize.y, false);
          camera.aspect = previousSize.x / Math.max(previousSize.y, 1);
          camera.updateProjectionMatrix();
        }
      };

      const orbitControls = new OrbitControls(camera, renderer.domElement);
      orbitControls.target.set(...(savedCameraDefinition?.target ?? [0, 1, 0]));
      orbitControls.enabled = interactionMode !== "transform";
      orbitControls.update();
      const onDraggingChanged = (event: { value?: unknown }) => { orbitControls.enabled = !Boolean(event.value) && interactionMode !== "transform"; };
      const onTransformMouseUp = () => {
        const object = transformControls.object;
        const entityId = object?.userData.stageEntityId;
        if (object && typeof entityId === "string") onEntityTransformChange(entityId, readEntityTransform(object));
      };
      const onCameraEnd = () => {
        if (interactionMode !== "camera" || !savedCameraDefinition) return;
        onCameraChange({
          ...savedCameraDefinition,
          position: [camera.position.x, camera.position.y, camera.position.z],
          rotation: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
          target: [orbitControls.target.x, orbitControls.target.y, orbitControls.target.z]
        });
      };
      transformControls.addEventListener("dragging-changed", onDraggingChanged);
      transformControls.addEventListener("mouseUp", onTransformMouseUp);
      orbitControls.addEventListener("end", onCameraEnd);

      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      const canvas = renderer.domElement;
      const onContextLost = (event: Event) => { event.preventDefault(); onContextStatusChange("lost"); };
      const onContextRestored = () => { onContextStatusChange("ready"); resize(); };
      canvas.addEventListener("webglcontextlost", onContextLost, false);
      canvas.addEventListener("webglcontextrestored", onContextRestored, false);
      let animationFrame = 0;
      const render = () => {
        if (!paused && document.visibilityState !== "hidden") renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(render);
      };
      onContextStatusChange("ready");
      render();
      releaseRef.current = () => {
        if (released) return;
        released = true;
        cancelAnimationFrame(animationFrame);
        transformControls.detach();
        transformControls.dispose();
        orbitControls.dispose();
        renderer.renderLists.dispose();
        renderer.dispose();
        tracker.dispose();
        renderPassesRef.current = null;
      };
      return () => {
        observer.disconnect();
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        transformControls.removeEventListener("dragging-changed", onDraggingChanged);
        transformControls.removeEventListener("mouseUp", onTransformMouseUp);
        orbitControls.removeEventListener("end", onCameraEnd);
        releaseRef.current?.();
        releaseRef.current = null;
        entityObjects.clear();
        host.replaceChildren();
      };
    }, [activeCameraId, interactionMode, onCameraChange, onContextStatusChange, onEntityTransformChange, overlayMode, panoramaUrl, paused, selectedEntityId, stage]);

    return <div className="spatial-stage-viewport" ref={hostRef} aria-label="空间预演视口" />;
  }
);
