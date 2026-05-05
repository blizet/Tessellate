"use client";

import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

// ─── Equirectangular panorama applied as scene background + env light ─────────

function EquiEnv({ url }: { url: string }) {
  const texture = useLoader(THREE.TextureLoader, url);
  const { scene } = useThree();

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    scene.background = texture;
    scene.environment = texture;
    return () => {
      scene.background = null;
      scene.environment = null;
    };
  }, [texture, scene]);
  /* eslint-enable react-hooks/immutability */

  return null;
}

// ─── Auto-framing box model ───────────────────────────────────────────────────

function Model({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url);
  const { camera } = useThree();

  const scene = useMemo(() => {
    const s = gltf.scene.clone();

    const box    = new THREE.Box3().setFromObject(s);
    const centre = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    s.position.sub(centre);

    const fov  = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    // Multiplier 1.43 ≈ 1/0.70 → box fills ~70% of the viewport
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.43;
    camera.position.set(dist * 0.65, dist * 0.45, dist);
    camera.lookAt(0, 0, 0);

    return s;
  }, [gltf.scene, camera]);

  return <primitive object={scene} />;
}

function LoadingSpinner() {
  return (
    <mesh rotation={[0.4, 0.4, 0]}>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#ffd400" />
    </mesh>
  );
}

// ─── GLB base64 → blob URL ────────────────────────────────────────────────────

function glbBase64ToObjectUrl(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
  } catch {
    return null;
  }
}

// ─── Public component ─────────────────────────────────────────────────────────

export function Preview3D({
  glbBase64,
  bgUrl,
  emptyLabel,
}: {
  glbBase64: string | null;
  bgUrl: string | null;
  emptyLabel: string;
}) {
  const url = useMemo(
    () => (glbBase64 ? glbBase64ToObjectUrl(glbBase64) : null),
    [glbBase64],
  );

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (!url) {
    return (
      <div
        className="flex h-[420px] w-full items-center justify-center rounded-xl text-sm"
        style={{
          border: "1.5px dashed var(--ts-border)",
          color: "var(--ts-text-muted)",
          background: "var(--ts-surface-alt)",
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className="h-[420px] w-full overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--ts-border)", background: "var(--ts-white)" }}
    >
      <Canvas
        shadows
        camera={{ position: [1.8, 1.2, 2.4], fov: 46 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
      >
        {/* Background: panorama if supplied, otherwise solid colour + preset env */}
        {!bgUrl && <color attach="background" args={["#ffffff"]} />}

        <ambientLight intensity={bgUrl ? 0.4 : 0.7} />
        <directionalLight castShadow position={[5, 8, 6]} intensity={bgUrl ? 1.0 : 1.6} />
        <directionalLight position={[-4, 3, -4]} intensity={0.3} />

        <Suspense key={url} fallback={<LoadingSpinner />}>
          {/* Equirectangular panorama overrides both background and env lighting */}
          {bgUrl && <EquiEnv url={bgUrl} />}

          <Model url={url} />

          {/* Fallback preset env light when no panorama */}
          {!bgUrl && <Environment preset="studio" />}
        </Suspense>

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.07}
          minDistance={0.4}
          maxDistance={12}
        />
      </Canvas>
    </div>
  );
}
