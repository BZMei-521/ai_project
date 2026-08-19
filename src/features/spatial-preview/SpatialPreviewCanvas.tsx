import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { CameraPlan, SpatialObject, SpatialScene } from "../../domains/spatial-scene/types";
import { normalizeCameraPlan } from "../../domains/spatial-scene/sceneMath";
import { useSpatialPreviewStore } from "./spatialPreviewStore";

export type SpatialPreviewCanvasProps = {
  scene: SpatialScene;
  selection: string | null;
  onSelectionChange: (selection: string | null) => void;
  onSceneChange: (scene: SpatialScene) => void;
  panoramaBackground?: THREE.Texture | THREE.Color | null;
};

const proxyColor: Record<SpatialObject["objectKind"], number> = {
  character: 0x64b5f6,
  prop: 0xd6a85d,
  camera: 0x9aa4b2,
  light: 0xffd166,
  environment: 0x7b8794,
  custom: 0x98c379
};

function createProxy(object: SpatialObject): THREE.Mesh {
  const geometry = object.objectKind === "character"
    ? new THREE.CapsuleGeometry(0.42, 1.2, 6, 12)
    : object.objectKind === "environment"
      ? new THREE.BoxGeometry(2.4, 0.35, 2.4)
      : new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const material = new THREE.MeshStandardMaterial({ color: proxyColor[object.objectKind], roughness: 0.76, metalness: 0.08 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = object.label || object.id;
  mesh.userData.spatialObjectId = object.id;
  mesh.position.set(object.position.x, object.position.y, object.position.z);
  mesh.rotation.set(object.rotation.x, object.rotation.y, object.rotation.z);
  mesh.scale.set(object.scale.x, object.scale.y, object.scale.z);
  mesh.visible = object.visibility === "visible";
  return mesh;
}

function cameraFromPlan(plan: CameraPlan, aspect: number): THREE.PerspectiveCamera {
  const normalized = normalizeCameraPlan(plan);
  const camera = new THREE.PerspectiveCamera(normalized.fov, aspect, normalized.near ?? 0.1, normalized.far ?? 1000);
  const position = normalized.position ?? { x: 5, y: 4, z: 7 };
  const target = normalized.target ?? { x: 0, y: 1, z: 0 };
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(target.x, target.y, target.z);
  return camera;
}

export function SpatialPreviewCanvas({ scene, selection, onSelectionChange, onSceneChange, panoramaBackground = null }: SpatialPreviewCanvasProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeTool = useSpatialPreviewStore((state) => state.activeTool);
  const recordScene = useSpatialPreviewStore((state) => state.recordScene);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const width = Math.max(host.clientWidth, 320);
    const height = Math.max(host.clientHeight, 240);
    const renderScene = new THREE.Scene();
    renderScene.background = panoramaBackground ?? new THREE.Color(0x101820);
    const camera = cameraFromPlan(scene.camera, width / height);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "Spatial scene preview");
    host.replaceChildren(renderer.domElement);

    renderScene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(4, 8, 5);
    renderScene.add(keyLight);
    renderScene.add(new THREE.GridHelper(20, 20, 0x536273, 0x283646));
    const proxies = scene.objects.map(createProxy);
    proxies.forEach((proxy) => renderScene.add(proxy));

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 1, 0);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode(activeTool === "select" ? "translate" : activeTool);
    renderScene.add(transform.getHelper());
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selectedMesh = () => proxies.find((proxy) => proxy.userData.spatialObjectId === selection) ?? null;

    const syncTransform = (): SpatialScene | null => {
      const mesh = selectedMesh();
      if (!mesh) return null;
      const objectId = String(mesh.userData.spatialObjectId);
      const nextObjects = scene.objects.map((object) => object.id === objectId
        ? {
            ...object,
            position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
            rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
            scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }
          }
        : object);
      return { ...scene, revision: scene.revision + 1, objects: nextObjects, updatedAt: new Date().toISOString() };
    };
    let transformDirty = false;
    const onTransformDrag = (event: { value: unknown }) => {
      const dragging = Boolean(event.value);
      orbit.enabled = !dragging;
      if (!dragging && transformDirty) {
        transformDirty = false;
        const nextScene = syncTransform();
        if (nextScene) {
          recordScene(scene, nextScene);
          onSceneChange(nextScene);
        }
      }
    };
    const onObjectChange = () => { transformDirty = true; };
    transform.addEventListener("dragging-changed", onTransformDrag);
    transform.addEventListener("objectChange", onObjectChange);

    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(proxies, false)[0]?.object;
      onSelectionChange(hit?.userData.spatialObjectId ? String(hit.userData.spatialObjectId) : null);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const attachSelected = () => {
      const mesh = selectedMesh();
      if (mesh && activeTool !== "select") transform.attach(mesh);
      else transform.detach();
    };
    attachSelected();
    const resize = () => {
      const nextWidth = Math.max(host.clientWidth, 320);
      const nextHeight = Math.max(host.clientHeight, 240);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight, false);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(host);
    let frame = 0;
    const animate = () => { frame = window.requestAnimationFrame(animate); orbit.update(); renderer.render(renderScene, camera); };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      transform.removeEventListener("dragging-changed", onTransformDrag);
      transform.removeEventListener("objectChange", onObjectChange);
      transform.dispose();
      orbit.dispose();
      renderScene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else if (material) material.dispose();
      });
      renderer.dispose();
      host.replaceChildren();
    };
  }, [scene, selection, activeTool, onSceneChange, onSelectionChange, panoramaBackground]);

  useEffect(() => {
    useSpatialPreviewStore.getState().setSelection(selection);
  }, [selection]);

  return <div ref={hostRef} style={{ width: "100%", minHeight: 280, height: "clamp(280px, 58vh, 680px)", aspectRatio: "16 / 9", overflow: "hidden", background: "#101820" }} />;
}
