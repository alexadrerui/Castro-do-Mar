# Authors the ObjectSculptSpec for the composite castro house from analysis.md. Run from this folder.
# Frame: metres, +Y up, front = the porch / door side (+Z), origin = ground at the body centre.
import json, copy

S = 'spec.json'
s = json.load(open(S, encoding='utf-8'))
tmpl = s['componentTree'][0]
mtmpl = s['materials'][0]

def comp(id, name, level, parent, primitive, topo, rationale, dims, pos, material, role='structure', features=None, attach=None, conf=0.75, rot=(0, 0, 0), evidence=('ref_1',), detail_ids=()):
    c = copy.deepcopy(tmpl)
    c.update({'id': id, 'name': name, 'level': level, 'role': role, 'parent': parent, 'primitive': primitive,
              'topologyClass': topo, 'topologyRationale': rationale, 'confidence': conf, 'importance': 0.9 if level == 'macro' else 0.6,
              'material': material, 'materialLayers': [material], 'evidenceRefs': list(evidence), 'details': list(detail_ids),
              'fidelityTier': 'stylized-procedural'})
    c['dimensions'] = {'width': dims[0], 'height': dims[1], 'depth': dims[2], 'units': 'metres', 'confidence': conf}
    c['transform'] = {'position': list(pos), 'rotation': list(rot), 'scale': [1, 1, 1]}
    c['attachment'] = attach
    c['localFeatures'] = features or []
    c['actionProfile']['animationRole'] = 'static-part'
    c['actionProfile']['pivot']['mode'] = 'base'
    c['actionProfile']['destruction']['fractureGroup'] = id
    c['actionProfile']['destruction']['debrisMaterial'] = material
    return c

def att(parent, start, end, contact='butt', embed=0.05, gap=0.02):
    return {'parentSocket': parent + '.surface', 'localStart': list(start), 'localEnd': list(end), 'contactType': contact,
            'embedDepth': embed, 'overlap': embed, 'gapTolerance': gap}

def feat(id, kind, desc, params):
    return {'id': id, 'kind': kind, 'description': desc, 'geometryEffect': params}

C = []
C.append(comp('root', 'Casa composta do castro', 'macro', None, 'group', 'assembled-solid',
              'Assembly of architectural solids; each part is its own named pivot.', (14, 8.5, 12), (0, 0, 0), 'granite-dry-stone', 'body', conf=0.8,
              evidence=('ref_1', 'ref_2', 'ref_3', 'ref_4', 'ref_5')))
# ---------------- body
C.append(comp('body-wall', 'Rectangular dwelling walls', 'macro', 'root', 'extruded-profile', 'thick-shell',
              'Four dry-stone walls (0.6 m thick) around a rectangle, openings cut for the door and the side gateway.',
              (8.0, 2.5, 5.5), (-1.2, 0, 0), 'granite-dry-stone', features=[
                  feat('side-gateway', 'opening', 'Wide stone-framed opening on the long side wall', {'width': 2.2, 'height': 2.0, 'wall': 'west'}),
              ], attach=att('root', (-1.2, 0, 0), (-1.2, 2.5, 0), 'embed', 0.3), evidence=('ref_1', 'ref_2', 'ref_4'), detail_ids=('dry-stone-courses', 'side-gateway')))
C.append(comp('door', 'Door with stone jambs, lintel and threshold', 'meso', 'body-wall', 'box-assembly', 'assembled-solid',
              'Dressed stone jambs and lintel framing a dark recess; a stone step in front.',
              (1.3, 2.1, 0.7), (0.4, 0, 2.75), 'granite-dressed', features=[
                  feat('jambs', 'frame', 'Two dressed stone jambs', {'width': 0.32}),
                  feat('lintel', 'frame', 'Stone lintel', {'height': 0.3}),
                  feat('threshold', 'step', 'Stone threshold step', {'height': 0.18, 'depth': 0.5}),
              ], attach=att('body-wall', (0.4, 0, 2.75), (0.4, 2.1, 2.75)), detail_ids=('door-frame',)))
C.append(comp('door-gable', 'Carved timber gable over the door', 'meso', 'door', 'extruded-profile', 'thin-shell',
              'Triangular board with a raised border and a six-petal rosette in relief.',
              (1.9, 0.9, 0.12), (0.4, 2.15, 2.85), 'timber-carved', features=[
                  feat('rosette', 'relief', 'Six-petal Celtic rosette', {'radius': 0.22, 'petals': 6}),
                  feat('border', 'relief', 'Raised border along the rakes', {'width': 0.08}),
              ], attach=att('door', (0.4, 2.1, 0), (0.4, 3.0, 0)), conf=0.6, detail_ids=('carved-gable',)))
C.append(comp('body-roof', 'Thatch roof of the dwelling (gable + hip)', 'macro', 'body-wall', 'lofted-shell', 'thick-shell',
              'Two pitches with a hip at the far end, five to seven stepped courses with frayed edges; a thatch dormer hood over the door; ridge roll.',
              (9.6, 3.2, 7.0), (-1.2, 2.3, 0), 'thatch-old', features=[
                  feat('courses', 'stepped-layers', 'Stepped thatch courses', {'count': 6, 'step': 0.08}),
                  feat('dormer', 'hood', 'Thatch hood projecting over the door gable', {'width': 2.4, 'projection': 0.9}),
                  feat('ridge-roll', 'ridge', 'Rolled thatch ridge', {'radius': 0.22}),
                  feat('hip', 'hip', 'Hip at the end away from the tower', {}),
              ], attach=att('body-wall', (-1.2, 2.3, 0), (-1.2, 5.5, 0), 'overlap', 0.3), evidence=('ref_1', 'ref_2', 'ref_4', 'ref_5'),
              detail_ids=('thatch-courses', 'thatch-dormer')))
# ---------------- tower
C.append(comp('tower-wall', 'Round tower / round house wall', 'macro', 'root', 'cylinder-shell', 'thick-shell',
              'Dry-stone cylinder (0.6 m wall) abutting the gable end of the dwelling, taller than the body walls, crenellated crown of protruding stones, small square window.',
              (5.4, 3.2, 5.4), (3.6, 0, -0.2), 'granite-dry-stone', features=[
                  feat('crown', 'crenellation', 'Irregular protruding crown stones', {'count': 14, 'height': 0.35}),
                  feat('window', 'opening', 'Small square window', {'size': 0.45, 'height': 1.4}),
              ], attach=att('root', (3.6, 0, -0.2), (3.6, 3.2, -0.2), 'embed', 0.3), evidence=('ref_3', 'ref_4', 'ref_5'), detail_ids=('tower-crown', 'tower-window')))
C.append(comp('tower-roof', 'Stepped thatch cone of the tower', 'macro', 'tower-wall', 'stacked-cones', 'thick-shell',
              'Three to four stacked thatch tiers (stepped profile) rising above the body roof and merging into it.',
              (5.6, 3.6, 5.6), (3.6, 3.0, -0.2), 'thatch-old', features=[
                  feat('tiers', 'stepped-layers', 'Stacked cone tiers', {'count': 4}),
              ], attach=att('tower-wall', (0, 3.0, 0), (0, 6.6, 0), 'overlap', 0.2), evidence=('ref_3', 'ref_4'), detail_ids=('tower-cone-steps',)))
# ---------------- porch
C.append(comp('porch', 'Timber porch (lean-to)', 'macro', 'body-wall', 'frame-assembly', 'assembled-solid',
              'Four posts with knee braces, a beam with round rafter ends, single-pitch plank roof against the front wall.',
              (4.2, 2.6, 2.0), (-3.0, 0, 3.75), 'timber', features=[
                  feat('posts', 'instanced-posts', 'Four squared posts', {'count': 4, 'section': 0.18}),
                  feat('braces', 'knee-braces', 'Diagonal knee braces post-to-beam', {'count': 6}),
                  feat('rafter-ends', 'instanced-cylinders', 'Round rafter ends along the beam', {'count': 7, 'radius': 0.07}),
                  feat('plank-roof', 'planks', 'Single-pitch plank roof', {'boards': 14, 'pitch': 14}),
              ], attach=att('body-wall', (-3.0, 2.3, 2.75), (-3.0, 0, 4.75), 'butt', 0.05), detail_ids=('porch-rafter-ends', 'porch-braces', 'plank-roof')))
C.append(comp('porch-props', 'Yard props under the porch', 'meso', 'porch', 'instanced-props', 'assembled-solid',
              'Two-wheel cart with spoked wheels, two barrels, a basket and jars; uses the project prop builders.',
              (4.0, 1.2, 1.6), (-3.0, 0, 3.8), 'timber', features=[
                  feat('cart', 'prop', 'Hand cart with spoked wheels', {}),
                  feat('barrels', 'prop', 'Two barrels', {'count': 2}),
                  feat('jars', 'prop', 'Basket and jars', {'count': 3}),
              ], attach=att('porch', (0, 0, 0), (0, 0, 0), 'rest-on-ground', 0.0), conf=0.7, detail_ids=('yard-props',)))
# ---------------- shelter
C.append(comp('shelter', 'Detached round kitchen shelter', 'macro', 'root', 'radial-assembly', 'assembled-solid',
              'Low curved dry-stone wall (open on one side), six posts, a wide thatch cone; fire in the middle.',
              (3.8, 3.4, 3.8), (5.0, 0, 5.2), 'granite-dry-stone', features=[
                  feat('low-wall', 'curved-wall', 'Low curved wall, ~250 degrees', {'height': 0.9, 'arc': 250}),
                  feat('posts', 'instanced-posts', 'Six round posts', {'count': 6, 'radius': 0.1}),
                  feat('cone', 'thatch-cone', 'Thatch cone with wide eave', {'eave': 0.6}),
                  feat('fire', 'emissive', 'Fire / embers', {}),
              ], attach=att('root', (5.0, 0, 5.2), (5.0, 3.4, 5.2), 'rest-on-ground', 0.0), evidence=('ref_1', 'ref_2', 'ref_3'), detail_ids=('shelter-wall', 'shelter-fire')))
s['componentTree'] = C

def mat(id, name, base, sec, rough, notes, overrides=()):
    m = copy.deepcopy(mtmpl)
    m.update({'id': id, 'name': name, 'baseColor': base, 'color': base})
    m['albedo'] = {'dominant': base, 'secondary': list(sec), 'samplingNotes': 'Read from the reference under grey studio light; tuned against the village palette.'}
    m['colorVariation']['palette'] = [base, *sec]
    m['roughness']['base'] = rough
    m['localOverrides'] = list(overrides)
    m['shaderNotes'] = list(notes)
    return m

s['materials'] = [
    mat('granite-dry-stone', 'Dry-stone granite (project stoneMaterial)', '#6d6a63', ['#57544e', '#8a867c'], 0.92,
        ['Project world/materials.js stoneMaterial on the baked stone cells (surfaceBake.js).'],
        [{'id': 'dry-stone-courses', 'region': 'all walls', 'effect': 'flat stones in irregular courses, dark dry joints', 'albedo': '#2b2721'}]),
    mat('granite-dressed', 'Dressed granite (jambs, lintel)', '#7a766d', ['#66625a'], 0.9,
        ['stoneDark variant with longer stones (len 0.9, rowH 0.45).']),
    mat('thatch-old', 'Old thatch (project thatchMaterial)', '#5a5040', ['#463e31', '#7a6e56'], 0.97,
        ['Project thatchMaterial; fibres down the slope; stepped courses in the geometry.']),
    mat('timber', 'Weathered timber', '#5a3c2a', ['#46301f', '#6e4a33'], 0.85, ['Project woodMaterial (red-brown).']),
    mat('timber-carved', 'Carved timber', '#5c3e2c', ['#3f2a1d'], 0.85, ['woodMaterial; relief is geometry.']),
    mat('fire', 'Fire', '#ff8a2a', ['#ffd27a'], 1.0, ['Project emberMaterial (emissive).'],
        [{'id': 'shelter-fire', 'region': 'shelter centre', 'effect': 'emissive embers', 'emissive': '#ff8a2a'}]),
]

s['repetitionSystems'] = [
    {'id': 'thatch-courses', 'componentRef': 'body-roof', 'distribution': 'stacked along the slope', 'count': 6, 'method': 'stepped shells'},
    {'id': 'tower-tiers', 'componentRef': 'tower-roof', 'distribution': 'stacked cones', 'count': 4, 'method': 'stacked cones'},
    {'id': 'crown-stones', 'componentRef': 'tower-wall', 'distribution': 'radial', 'count': 14, 'method': 'boxes with jitter'},
    {'id': 'rafter-ends', 'componentRef': 'porch', 'distribution': 'linear', 'count': 7, 'method': 'cylinders'},
    {'id': 'shelter-posts', 'componentRef': 'shelter', 'distribution': 'radial', 'count': 6, 'method': 'cylinders'},
]

s['silhouette'] = {
    'boundingShape': 'L-shaped composite: a 8 x 5.5 m rectangular block with a gable+hip thatch roof, a 5.4 m round tower on its east gable end with a stepped cone rising above, a lean-to porch on the front, and a detached 3.8 m round shelter in front of the tower.',
    'aspectRatios': ['body length : width ~1.45', 'tower height above body eave ~1.2 m', 'roof height ~ wall height'],
    'symmetry': 'asymmetric',
    'dominantCurves': ['tower cylinder and stepped cone', 'shelter cone', 'thatch eave lines'],
    'negativeSpaces': ['door recess', 'porch under-roof', 'shelter open side'],
    'landmarks': ['carved gable over the door', 'tower crown stones', 'porch rafter ends'],
}
s['coordinateFrame'] = {'front': '+Z, the porch / door side (ref_1)', 'up': '+Y', 'scaleReference': 'metres; door ~2 m tall'}
s['viewEvidence'] = [
    {'id': f'ref_{i}', 'view': v, 'imageRegion': {'x': 0, 'y': 0, 'width': 1, 'height': 1, 'units': 'normalized'}, 'observations': [], 'confidence': c}
    for i, v, c in [(1, 'front three-quarter', 0.85), (2, 'rear-side three-quarter', 0.8), (3, 'tower side', 0.8), (4, 'back', 0.8), (5, 'top (plan)', 0.75)]
]
s['featureReviewTargets'] = [
    {'id': 'overall-silhouette', 'name': 'L composite silhouette: block + round tower + stepped cone + porch + shelter', 'tier': 'critical', 'passIds': ['blockout'], 'minimumScore': 0.75, 'mustPass': True, 'componentRefs': ['body-wall', 'tower-wall', 'body-roof', 'tower-roof', 'shelter'], 'evidenceRefs': ['ref_1', 'ref_4', 'ref_5']},
    {'id': 'roof-system', 'name': 'Thatch roofs: gable + hip, stepped tower cone, dormer hood', 'tier': 'critical', 'passIds': ['structural-pass', 'form-refinement'], 'minimumScore': 0.7, 'mustPass': True, 'componentRefs': ['body-roof', 'tower-roof'], 'evidenceRefs': ['ref_1', 'ref_3', 'ref_4']},
    {'id': 'front-features', 'name': 'Door with stone frame, carved gable, timber porch with rafter ends', 'tier': 'critical', 'passIds': ['structural-pass', 'form-refinement'], 'minimumScore': 0.7, 'mustPass': True, 'componentRefs': ['door', 'door-gable', 'porch'], 'evidenceRefs': ['ref_1', 'ref_2']},
    {'id': 'reference-material-system', 'name': 'Dry-stone, thatch and timber materials', 'tier': 'critical', 'passIds': ['material-pass', 'surface-pass'], 'minimumScore': 0.7, 'mustPass': True, 'componentRefs': ['body-wall', 'body-roof', 'porch'], 'evidenceRefs': ['ref_1', 'ref_4']},
    {'id': 'tower-crown', 'name': 'Tower crown stones and window', 'tier': 'important', 'passIds': ['form-refinement'], 'minimumScore': 0.6, 'mustPass': False, 'componentRefs': ['tower-wall'], 'evidenceRefs': ['ref_3', 'ref_4']},
    {'id': 'shelter', 'name': 'Shelter: low wall open on one side, posts, cone, fire', 'tier': 'important', 'passIds': ['structural-pass'], 'minimumScore': 0.6, 'mustPass': False, 'componentRefs': ['shelter'], 'evidenceRefs': ['ref_1', 'ref_3']},
]
for bp in s['buildPasses']:
    bp['componentRefs'] = [c['id'] for c in C]
s['assumptions'] = [
    'Stylized procedural reconstruction with the project materials; the photographs are not projected.',
    'Plan relation of tower and body inferred from the top view (ref_5).',
    'Interior is not modelled; the doorway is a dark recess.',
    'Local spec search returned no architectural evidence (weapon-centric corpus); dimensions are inferred from the door height.',
]
s['risks'] = ['Thatch courses read as layered only if the stepped geometry is deep enough.', 'Tower cone merging into the body roof can intersect visibly.']
s['suitability'] = 'pass'
s['scores'] = {'object_isolation': 5, 'silhouette_readability': 4, 'depth_inference': 4, 'primitive_decomposition': 4, 'material_procedurality': 4, 'occlusion_risk': 2, 'interaction_fit': 3}
s['performanceBudget']['targetTriangles'] = 60000
s['performanceBudget']['maxDrawCalls'] = 16
json.dump(s, open(S, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('ok', len(C), 'components')
