# Fills the pre-spec assessment from the visual analysis (analysis.md). Run from this folder.
import json

A = 'assessment.json'
d = json.load(open(A, encoding='utf-8'))
a = d['preSpecAssessment']

a['objectClass'] = {
    'primaryType': 'composite castro house (rectangular dwelling + round tower) with a detached round kitchen shelter',
    'primaryDomain': 'object',
    'formLanguage': ['geometric', 'organic-edges'],
    'structureKind': ['architectural', 'assembly', 'radial (tower, shelter)', 'repetition (stones, posts, rafters, thatch courses)'],
    'motionPotential': ['static', 'fire flicker in the shelter'],
    'materialFamilies': ['dry-stone granite', 'thatch', 'timber', 'carved timber', 'fire'],
    'notes': 'Game-model reference on a grey backdrop, five views (front 3/4, rear 3/4, tower side, back, top). Rebuilt procedurally with the project materials (no photo projection).'
}
a['complexity']['scores'] = {
    'silhouetteComplexity': 3, 'componentCount': 4, 'hierarchyDepth': 3, 'repetitionDensity': 4,
    'materialLayerCount': 3, 'localDetailDensity': 3, 'occlusionRisk': 2, 'actionReadinessNeed': 1
}
a['complexity']['estimatedCounts'] = {'macroComponents': 6, 'mesoComponents': 12, 'microFeatureGroups': 7, 'materialLayers': 5, 'repetitionSystems': 5}
a['complexity']['reasoning'] = [
    'Six macro parts (rectangular body, round tower, body roof, stepped tower cone, timber porch, detached shelter).',
    'Meso parts: door with stone jambs and lintel, carved gable with rosette, thatch dormer over the door, porch posts with braces, rafter ends, plank roof, side gateway, tower window, crenellated tower crown, ridge roll, shelter low wall, shelter posts.',
    'Repetition: wall stones (material), thatch courses, porch rafter ends, shelter posts, tower crown stones.',
    'Occlusion: interior not visible; plan relation from the top view (confidence 0.7).'
]
a['unknownsToResolveBeforeImplementation'] = [
    'Exact plan footprint of body vs tower (inferred from ref_5).',
    'Rosette motif detail (approximated as a six-petal Celtic rosette).',
    'Interior: not modelled (dark doorway).'
]

R = lambda x, y, w, h: {'x': x, 'y': y, 'width': w, 'height': h, 'units': 'normalized'}
def det(i, kind, desc, region, scale, affects, mtype, ref, conf, ev='ref_1.png'):
    return {'id': i, 'kind': kind, 'description': desc, 'region': region, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': mtype, 'ref': ref}, 'evidenceRef': ev, 'confidence': conf}

a['detailInventory'] = {
    'scanMethod': 'component-zones',
    'targetMinDetails': 10,
    'details': [
        det('thatch-courses', 'repetition', 'Five to seven stepped thatch courses with frayed, lighter lower edges on both roofs', R(0.03, 0.05, 0.62, 0.40), 'meso', 'roof silhouette + albedo', 'component.localFeatures', 'body-roof', 0.85),
        det('tower-cone-steps', 'contour', 'Tower cone built as three or four stacked thatch tiers (stepped profile)', R(0.40, 0.10, 0.40, 0.45), 'macro', 'silhouette', 'component.localFeatures', 'tower-roof', 0.8, 'ref_3.png'),
        det('tower-crown', 'repetition', 'Irregular crenellated crown of protruding stones on the tower wall head', R(0.38, 0.40, 0.42, 0.10), 'meso', 'silhouette', 'component.localFeatures', 'tower-wall', 0.8, 'ref_3.png'),
        det('dry-stone-courses', 'texture', 'Flat granite stones in irregular courses, dark dry joints, no mortar', R(0.05, 0.45, 0.65, 0.40), 'micro', 'albedo + normal', 'material.localOverrides', 'granite-dry-stone', 0.85),
        det('carved-gable', 'linework', 'Triangular timber gable over the door with a carved six-petal rosette and border', R(0.35, 0.33, 0.17, 0.12), 'meso', 'geometry relief', 'component.localFeatures', 'door-gable', 0.6),
        det('thatch-dormer', 'contour', 'Thatch dormer / hood projecting over the carved gable and door', R(0.32, 0.28, 0.25, 0.20), 'meso', 'silhouette', 'component.localFeatures', 'body-roof', 0.7),
        det('door-frame', 'contour', 'Door opening with dressed stone jambs, lintel and a stone threshold step', R(0.37, 0.45, 0.13, 0.32), 'meso', 'geometry', 'component.localFeatures', 'door', 0.85),
        det('porch-rafter-ends', 'repetition', 'Row of six or seven round rafter ends under the porch plank roof', R(0.09, 0.50, 0.28, 0.06), 'micro', 'geometry', 'component.localFeatures', 'porch', 0.85),
        det('porch-braces', 'contour', 'Porch posts with diagonal knee braces to the beam', R(0.09, 0.50, 0.28, 0.25), 'meso', 'geometry', 'component.localFeatures', 'porch', 0.8),
        det('plank-roof', 'texture', 'Single-pitch plank roof on the porch, red-brown timber boards', R(0.08, 0.48, 0.30, 0.06), 'meso', 'geometry + albedo', 'component.localFeatures', 'porch', 0.8),
        det('tower-window', 'contour', 'Small square window in the tower wall', R(0.58, 0.55, 0.05, 0.10), 'micro', 'geometry', 'component.localFeatures', 'tower-wall', 0.75, 'ref_3.png'),
        det('side-gateway', 'contour', 'Wide stone-framed opening on the long side wall', R(0.13, 0.45, 0.17, 0.35), 'meso', 'geometry', 'component.localFeatures', 'body-wall', 0.7, 'ref_2.png'),
        det('shelter-wall', 'contour', 'Low curved dry-stone wall around the shelter, open on one side', R(0.63, 0.65, 0.33, 0.20), 'meso', 'geometry', 'component.localFeatures', 'shelter', 0.85),
        det('shelter-fire', 'emissive', 'Fire / embers in the shelter', R(0.78, 0.72, 0.10, 0.08), 'micro', 'emissive', 'material.localOverrides', 'fire', 0.6),
        det('yard-props', 'repetition', 'Cart with spoked wheels, barrels, baskets, jars and fruit under the porch', R(0.04, 0.65, 0.35, 0.20), 'micro', 'geometry', 'component.localFeatures', 'porch-props', 0.75),
    ]
}
json.dump(d, open(A, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('ok', len(a['detailInventory']['details']), 'details')
