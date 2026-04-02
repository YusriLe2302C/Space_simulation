import { useRef, Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { EARTH_RADIUS_UNITS } from "../../utils/constants";

function EarthWithTexture() {
  const meshRef = useRef();
  const [colorMap, normalMap, specularMap] = useTexture([
    "/textures/earth_color.jpg",
    "/textures/earth_normal.jpg",
    "/textures/earth_specular.jpg",
  ]);

  return (
    <mesh ref={meshRef} name="earth">
      <sphereGeometry args={[EARTH_RADIUS_UNITS, 64, 64]} />
      <meshPhongMaterial
        map={colorMap}
        normalMap={normalMap}
        specularMap={specularMap}
        shininess={8}
      />
    </mesh>
  );
}

export function EarthFallback() {
  return (
    <mesh name="earth">
      <sphereGeometry args={[EARTH_RADIUS_UNITS, 64, 64]} />
      <meshPhongMaterial color={0x1a3a5c} shininess={8} />
    </mesh>
  );
}

export default EarthWithTexture;
