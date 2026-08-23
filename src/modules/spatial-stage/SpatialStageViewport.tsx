import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as THREE from "three";
import type { SceneStage } from "./types";
import { ThreeResourceTracker } from "./threeResourceTracker";

const MAX_PANORAMA_TEXTURE_WIDTH = 4096;

export type SpatialStageViewportHandle = {
  releaseGpuResources(): void;
};

export type SpatialStageViewportProps = {
  stage: SceneStage;
  panoramaUrl?: string;
  selectedEntityId?: string;
  paused: boolean;
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

export const SpatialStageViewport = forwardRef<SpatialStageViewportHandle, SpatialStageViewportProps>(
  function SpatialStageViewport({ stage, panoramaUrl, selectedEntityId, paused, onContextStatusChange }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const releaseRef = useRef<(() => void) | null>(null);

    useImperativeHandle(ref, () => ({
      releaseGpuResources() {
        releaseRef.current?.();
      }
    }), []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const tracker = new ThreeResourceTracker();
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        onContextStatusChange("failed");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x0b1220, 1);
      host.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
      camera.position.set(0, 1.6, 4);
      camera.lookAt(0, 1, 0);
      const ambient = new THREE.HemisphereLight(0xffffff, 0x24324a, 1.4);
      scene.add(ambient);
      const grid = new THREE.GridHelper(20, 20, 0x52708f, 0x20324c);
      tracker.track(grid.geometry);
      if (Array.isArray(grid.material)) grid.material.forEach((material) => tracker.track(material));
      else tracker.track(grid.material);
      scene.add(grid);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ color: 0x172235, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      );
      tracker.track(ground.geometry);
      tracker.track(ground.material);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const panoramaSphere = new THREE.Mesh(
        new THREE.SphereGeometry(40, 48, 24),
        new THREE.MeshBasicMaterial({ color: 0x2b3b54, side: THREE.BackSide })
      );
      tracker.track(panoramaSphere.geometry);
      tracker.track(panoramaSphere.material as THREE.Material);
      if (panoramaUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(panoramaUrl, (texture) => {
          if (texture.image?.width > MAX_PANORAMA_TEXTURE_WIDTH) {
            texture.dispose();
            return;
          }
          tracker.track(texture);
          const material = panoramaSphere.material as THREE.MeshBasicMaterial;
          material.map = texture;
          material.needsUpdate = true;
        });
      }
      scene.add(panoramaSphere);

      const depthSource = stage.environment.sources.find((source) => source.kind === "depth_map");
      if (depthSource) {
        const depthLoader = new THREE.TextureLoader();
        depthLoader.load(depthSource.depthUrl, (depthTexture) => {
          tracker.track(depthTexture);
          depthTexture.colorSpace = THREE.NoColorSpace;
          const geometry = new THREE.PlaneGeometry(4, 4 * depthSource.height / depthSource.width, 128, 72);
          const material = new THREE.MeshStandardMaterial({
            color: 0xb8c8d8,
            displacementMap: depthTexture,
            displacementScale: 1.1,
            displacementBias: -0.55,
            side: THREE.DoubleSide,
            roughness: 0.9
          });
          tracker.track(geometry);
          tracker.track(material);
          const surface = new THREE.Mesh(geometry, material);
          surface.position.set(0, 1.2, -1.5);
          scene.add(surface);
        });
      }

      const entityMeshes: THREE.Mesh[] = [];
      for (const entity of stage.entities) {
        const material = new THREE.MeshStandardMaterial({
          color: entity.id === selectedEntityId ? 0xf2b84b : 0x5b9bd5,
          roughness: 0.72,
          metalness: 0.05
        });
        const geometry = makeProxyGeometry(entity.geometry.kind, entity.geometry.size);
        tracker.track(geometry);
        tracker.track(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...entity.transform.position);
        mesh.scale.set(...entity.transform.scale);
        mesh.visible = entity.visibility === "visible";
        scene.add(mesh);
        entityMeshes.push(mesh);
      }

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
      const onContextLost = (event: Event) => {
        event.preventDefault();
        onContextStatusChange("lost");
      };
      const onContextRestored = () => {
        onContextStatusChange("ready");
        resize();
      };
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
        cancelAnimationFrame(animationFrame);
        renderer.renderLists.dispose();
        renderer.dispose();
        tracker.dispose();
      };
      return () => {
        observer.disconnect();
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        releaseRef.current?.();
        releaseRef.current = null;
        entityMeshes.length = 0;
        host.replaceChildren();
      };
    }, [onContextStatusChange, panoramaUrl, paused, selectedEntityId, stage]);

    return <div className="spatial-stage-viewport" ref={hostRef} aria-label="空间预演视口" />;
  }
);
