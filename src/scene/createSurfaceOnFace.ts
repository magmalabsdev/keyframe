import * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { createSurfaceObject, rectPoints } from '../state/defaults';
import { getFaceTriangles } from './faceGroups';
import { computeFacePlacement, faceVertices } from './facePlacement';
import type { Transform } from '../state/types';

/**
 * Creates a flat surface lying on the clicked face, parented to the host so it
 * moves and animates with it.
 *
 * All the math stays in the host's local space. That is exact because
 * SceneObjects renders a mesh at `position={centerOfRotation}` with no
 * rotation or scale of its own, so the mesh node's frame is the host group's
 * frame — which sidesteps having to correct normals for non-uniform scale.
 */
export function createSurfaceOnFace(
  hostId: string,
  mesh: THREE.Mesh,
  faceIndex: number,
  faceNormalLocal: THREE.Vector3,
): void {
  const scene = getActiveScene(useDocumentStore.getState().project);
  if (!scene.objects.some((o) => o.id === hostId)) return;

  const triangles = getFaceTriangles(mesh.geometry, faceIndex);
  const vertices = faceVertices(mesh.geometry, triangles, mesh.position);
  const placement = computeFacePlacement(vertices, faceNormalLocal);
  if (!placement) return;

  const transform: Transform = {
    position: placement.position,
    rotation: placement.rotation,
    // Left at 1: the polygon is sized in host-local units, so the surface
    // stretches with its host the way a decal should.
    scale: [1, 1, 1],
  };

  const surface = createSurfaceObject(scene.durationMs, {
    name: 'Surface',
    parentId: hostId,
    transform,
    // Near-black rather than the default light gray: this text is drawn onto
    // another object, and the default mesh color is itself light gray.
    color: '#14161a',
    surface: {
      content: 'text',
      showBackground: false,
      points: rectPoints(placement.width, placement.height),
    },
  });

  useDocumentStore.getState().addObjects([surface]);
  const editor = useEditorStore.getState();
  editor.setSelection([surface.id]);
  editor.setTool('move');
}
