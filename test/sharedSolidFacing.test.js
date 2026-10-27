import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGpuScene } from '../src/buildGpuScene.js';
import { buildSceneQuads } from '../src/mesh/buildSceneQuads.js';
import { buildStaticMeshFromGpuScene } from '../src/webgl/mesh/buildStaticMeshFromGpuScene.js';
import { createDynamicSectorWorldQuads } from '../src/index.js';
import { concaveSharedSolidMap, rectangularSector, connectedSectorMap } from './fixtures/syntheticMaps.js';
import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

function normal(quad) {
  const [a,b,c]=quad.corners;
  const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
}

test('shared-solid faces wind toward their owning interiors for concave, reversed and sliced walls',()=>{
  for(const variant of [{},{reverseWinding:true},{reverseSharedWall:true},{reorderWalls:true}]){
    const scene=buildGpuScene(concaveSharedSolidMap(variant));
    for(const wall of scene.walls.filter(w=>w.sharedSolidOffset)){
      const quad=[...buildSceneQuads({walls:[wall],floors:[],ceilings:[]})][0];
      const n=normal(quad);
      assert.equal(quad.cullBackFaces,true);
      assert.ok(n[0]*wall.interiorNormal.x+n[1]*wall.interiorNormal.y>0);
      const ordinary={...wall};delete ordinary.interiorNormal;
      const old=[...buildSceneQuads({walls:[ordinary],floors:[],ceilings:[]})][0];
      const vertexUvs=q=>q.corners.map((p,i)=>JSON.stringify([p,q.uvs[i]])).sort();
      assert.deepEqual(vertexUvs(quad),vertexUvs(old),'winding preserves every position/UV association');
    }
  }
});

test('one-sided shared faces batch separately from ordinary walls using the same material',()=>{
  const scene=buildGpuScene({sectors:[rectangularSector({id:'a',x0:0,x1:4}),rectangularSector({id:'b',x0:4,x1:8})]});
  const mesh=buildStaticMeshFromGpuScene(scene).mesh;
  const groups=mesh.groups.filter(g=>g.surfaceType==='wall'&&g.materialKey==='wall-a');
  assert.equal(groups.length,2);
  assert.equal(groups.filter(g=>g.cullBackFaces).length,1);
  assert.equal(groups.find(g=>g.cullBackFaces).indexCount,12);
  assert.ok(scene.walls.filter(w=>w.sharedSolidOffsetCap).every(w=>!w.interiorNormal),'end caps retain coverage from both sides');
});

test('ordinary walls, portal bands and portal trims keep their established two-sided coverage',()=>{
  const world=connectedSectorMap();
  world.portalOpenings=[{wallRef:{sectorId:world.sectors[0].id,wallIndex:1},bottomZ:1,topZ:3,trimMaterial:'track'}];
  const scene=buildGpuScene(world);
  assert.ok(scene.walls.some(w=>w.portalTrimSurfaceOffsetXY));
  assert.ok(scene.walls.every(w=>!w.interiorNormal));
  assert.ok([...buildSceneQuads(scene)].filter(q=>q.surfaceType==='wall').every(q=>!q.cullBackFaces));
});

test('dynamic shared-solid replacements carry the same sidedness and oriented geometry as static walls',()=>{
  const world=concaveSharedSolidMap();
  const staticQuads=[...buildSceneQuads(buildGpuScene(world))].filter(q=>q.cullBackFaces);
  const dynamic=createDynamicSectorWorldQuads({...world,dynamicSectorIds:['concave']})();
  const dynamicQuads=dynamic.filter(q=>q.cullBackFaces);
  assert.ok(dynamicQuads.length>0);
  for(const quad of dynamicQuads)assert.ok(staticQuads.some(q=>JSON.stringify(q)===JSON.stringify(quad)));
});

test('dynamic submission forwards the shared face culling policy to the draw path',()=>{
  const host=Object.create(WebGLRendererHost.prototype);let submitted;
  host.drawQuad=draw=>{submitted=draw;return true};host.materialAnimations=new Map();
  host.drawPreparedWorldQuad({quad:{textureKey:'wall',surfaceType:'wall',cullBackFaces:true,corners:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},alphaMode:'opaque'},[]);
  assert.equal(submitted.quad.cullBackFaces,true);
});
