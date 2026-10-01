# Surface pass: per-component surfaceDetail (tactile relief, locality) and material local overrides
# tied to evidence, from what materials.js slabMaterial / thatchMaterial(tufts) / woodMaterial do.
import json
S = 'spec.json'
s = json.load(open(S, encoding='utf-8'))
SD = {
 'granite-dry-stone': dict(macroRoughness=0.9, microRoughness=0.92, bumpAmplitude=0.012,
   normalPattern='coursed flat slabs (surfaceBake slab, 2.5:1 cells, 0.2 m courses): rounded-rectangle faces, the relief a height in metres via proceduralBump',
   displacementPattern='none (relief in the normal only; the walls stay flat boxes / ring walls)',
   occlusionPattern='recessed dark joints (gap 0x2c2b2a, roughness 1.0) and a darkened 4-35% band at each slab edge',
   edgeWearPattern='pillowed faces: the upper arris catches raking light; per-slab unevenness from the A channel',
   notes='Moss/soil settle in the joints low on the wall (worldPatch moss mask); detail fades to the mean tone past ~0.05-0.25 course per pixel.'),
 'granite-dressed': dict(macroRoughness=0.88, microRoughness=0.9, bumpAmplitude=0.012,
   normalPattern='same coursed slabs as the walls (door jambs, lintel, piers, merlons use castroStone)',
   displacementPattern='none', occlusionPattern='dark joints', edgeWearPattern='pillowed arrises',
   notes='Remapped to castroStone by CASTRO_KEYS; no separate dressed-stone finish (approximation).'),
 'thatch-old': dict(macroRoughness=0.97, microRoughness=0.97, bumpAmplitude=0.025,
   normalPattern='straw fibres down the slope (4 mm) plus tufts ~18 cm x 60 cm (2.5 cm), a height in metres',
   displacementPattern='course bands in the geometry (thatchFace / coneCourses lips 0.08-0.11 m, ragged eave)',
   occlusionPattern='darker hollows between tufts (colour x0.7-1.05); shadowed eave lip (uv.y < 0.6 m)',
   edgeWearPattern='grey sun-bleached vs damp dark patches (worldPatch G), sparse moss',
   notes='The texture 0.42 m courses are switched off (courses: 0): the geometry carries the courses.'),
 'timber': dict(macroRoughness=0.85, microRoughness=0.85, bumpAmplitude=0.4,
   normalPattern='grain along the member (surfaceBake wood)', displacementPattern='none',
   occlusionPattern='plank seams', edgeWearPattern='weathered grey on up-facing faces', notes='village woodMaterial'),
 'timber-carved': dict(macroRoughness=0.8, microRoughness=0.85, bumpAmplitude=0.4,
   normalPattern='grain; rosette and rakes as geometry relief', displacementPattern='rosette petals and torus in geometry',
   occlusionPattern='plank seams', edgeWearPattern='weathered grey on up-facing faces', notes='village woodMaterial'),
}
for c in s['componentTree']:
    c['surfaceDetail'] = dict(SD[c['material']])
OV = {
 'granite-dry-stone': [{'id': 'slab-joints', 'region': 'all walls', 'effect': 'recessed dark joints, pillowed slab faces 1.2 cm', 'evidenceRefs': ['crops/granite-dry-stone.png', 'ref_3', 'ref_4']},
                       {'id': 'joint-moss', 'region': 'lower wall', 'effect': 'moss/soil colour in the joints', 'evidenceRefs': ['ref_1']}],
 'thatch-old': [{'id': 'tufts', 'region': 'all roofs', 'effect': 'tuft relief 2.5 cm and darker hollows', 'evidenceRefs': ['crops/thatch-old.png', 'ref_1', 'ref_2']},
                {'id': 'eave-shadow', 'region': 'eave lip', 'effect': 'darkened lowest 0.6 m', 'evidenceRefs': ['ref_1', 'ref_3']}],
}
for m in s['materials']:
    for o in OV.get(m['id'], []):
        if not any(x.get('id') == o['id'] for x in m['localOverrides']): m['localOverrides'].append(o)
json.dump(s, open(S, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('ok')
