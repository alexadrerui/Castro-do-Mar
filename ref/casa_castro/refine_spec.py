# Second spec pass: allowed primitives/topology, meso components, colour recipes, detail kinds,
# lighting, scores, resolved unknowns. Patches spec.json in place (keeps the referencePbr evidence).
import json, copy

S = 'spec.json'
s = json.load(open(S, encoding='utf-8'))
comps = {c['id']: c for c in s['componentTree']}
tmpl = copy.deepcopy(comps['door'])

PRIM = {'root': 'box', 'body-wall': 'extrude', 'door': 'box', 'door-gable': 'extrude', 'body-roof': 'extrude',
        'tower-wall': 'cylinder', 'tower-roof': 'cone', 'porch': 'instanced-cluster', 'porch-props': 'instanced-cluster', 'shelter': 'cylinder'}
TOPO = {'root': 'assembled-solid', 'body-wall': 'assembled-solid', 'door': 'assembled-solid', 'door-gable': 'surface-relief',
        'body-roof': 'conforming-shell', 'tower-wall': 'assembled-solid', 'tower-roof': 'conforming-shell', 'porch': 'assembled-solid',
        'porch-props': 'assembled-solid', 'shelter': 'assembled-solid'}
for k, c in comps.items():
    c['primitive'] = PRIM[k]
    c['topologyClass'] = TOPO[k]

def rgba(h, a=1.0):
    h = h.lstrip('#'); return f'rgba({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)}, {a})'
REC = {
    'granite-dry-stone': ('#6d6a63', '#57544e', 'stone', 0.9), 'granite-dressed': ('#7a766d', '#66625a', 'stone', 0.85),
    'thatch-old': ('#5a5040', '#7a6e56', 'fabric', 0.6), 'timber': ('#5a3c2a', '#6e4a33', 'wood', 0.85),
    'timber-carved': ('#5c3e2c', '#3f2a1d', 'wood', 0.8), 'fire': ('#ff8a2a', '#ffd27a', 'unknown', 0.5),
}
def recipe(mat):
    d, s2, cls, conf = REC[mat]
    return {'dominantAlbedo': rgba(d), 'secondaryAlbedo': rgba(s2), 'materialClass': cls, 'materialClassConfidence': conf,
            'evidenceRef': f'crops/{mat}.png'}

def meso(id, name, parent, prim, topo, dims, pos, material, desc, conf=0.75, ev=('ref_1',)):
    c = copy.deepcopy(tmpl)
    c.update({'id': id, 'name': name, 'level': 'meso', 'parent': parent, 'primitive': prim, 'topologyClass': topo,
              'topologyRationale': desc, 'confidence': conf, 'material': material, 'materialLayers': [material],
              'evidenceRefs': list(ev), 'details': [], 'localFeatures': []})
    c['dimensions'] = {'width': dims[0], 'height': dims[1], 'depth': dims[2], 'units': 'metres', 'confidence': conf}
    c['transform'] = {'position': list(pos), 'rotation': [0, 0, 0], 'scale': [1, 1, 1]}
    c['attachment'] = {'parentSocket': parent + '.surface', 'localStart': list(pos), 'localEnd': list(pos), 'contactType': 'butt',
                       'embedDepth': 0.05, 'overlap': 0.05, 'gapTolerance': 0.02}
    c['actionProfile']['destruction']['fractureGroup'] = id
    return c

new = [
    meso('side-gateway', 'Side gateway in the long wall', 'body-wall', 'box', 'assembled-solid', (2.2, 2.0, 0.6), (-1.2, 0, -2.75), 'granite-dressed', 'Wide opening framed by large stones.', 0.7, ('ref_2',)),
    meso('dormer-hood', 'Thatch hood over the door', 'body-roof', 'extrude', 'conforming-shell', (2.4, 1.2, 1.2), (0.4, 2.6, 2.9), 'thatch-old', 'Small gabled thatch hood projecting over the carved gable.', 0.7),
    meso('ridge-roll', 'Rolled thatch ridge', 'body-roof', 'cylinder', 'conforming-shell', (8.0, 0.44, 0.44), (-1.6, 5.4, 0), 'thatch-old', 'Rolled ridge along the body roof.', 0.7, ('ref_2', 'ref_5')),
    meso('tower-crown', 'Crenellated crown stones', 'tower-wall', 'instanced-cluster', 'assembled-solid', (5.4, 0.35, 5.4), (3.6, 3.2, -0.2), 'granite-dry-stone', 'Irregular stones protruding above the tower wall head.', 0.8, ('ref_3', 'ref_4')),
    meso('tower-window', 'Small square tower window', 'tower-wall', 'box', 'assembled-solid', (0.45, 0.45, 0.6), (5.9, 1.4, 1.0), 'granite-dressed', 'Small square opening with a stone sill.', 0.7, ('ref_3',)),
    meso('porch-posts', 'Porch posts with knee braces', 'porch', 'instanced-cluster', 'assembled-solid', (4.2, 2.3, 0.2), (-3.0, 0, 4.7), 'timber', 'Four squared posts with diagonal braces to the beam.', 0.8),
    meso('porch-roof', 'Plank roof with round rafter ends', 'porch', 'box', 'assembled-solid', (4.4, 0.4, 2.2), (-3.0, 2.3, 3.75), 'timber', 'Single-pitch plank roof on a beam with round rafter ends.', 0.8, ('ref_1', 'ref_2')),
    meso('shelter-wall', 'Shelter low curved wall', 'shelter', 'cylinder', 'assembled-solid', (3.8, 0.9, 3.8), (5.0, 0, 5.2), 'granite-dry-stone', 'Low dry-stone wall over ~250 degrees, open towards the house.', 0.85, ('ref_1', 'ref_3')),
    meso('shelter-posts', 'Shelter posts', 'shelter', 'instanced-cluster', 'assembled-solid', (3.4, 2.2, 3.4), (5.0, 0.5, 5.2), 'timber', 'Six round posts on the wall carrying the cone.', 0.85),
    meso('shelter-roof', 'Shelter thatch cone', 'shelter', 'cone', 'conforming-shell', (4.6, 1.4, 4.6), (5.0, 2.6, 5.2), 'thatch-old', 'Wide-eaved thatch cone with stepped courses.', 0.85),
    meso('shelter-oven', 'Domed bread oven with fire glow', 'shelter', 'ellipsoid', 'assembled-solid', (1.4, 0.9, 1.1), (5.2, 0.3, 4.9), 'granite-dressed', 'Low clay/stone dome with a glowing mouth (observed in ref_1).', 0.6),
]
order = ['root', 'body-wall', 'door', 'door-gable', 'side-gateway', 'body-roof', 'dormer-hood', 'ridge-roll', 'tower-wall', 'tower-crown', 'tower-window',
         'tower-roof', 'porch', 'porch-posts', 'porch-roof', 'porch-props', 'shelter', 'shelter-wall', 'shelter-posts', 'shelter-roof', 'shelter-oven']
allc = {**comps, **{c['id']: c for c in new}}
for c in allc.values():
    c['colorMaterialRecipe'] = recipe(c['material'])
s['componentTree'] = [allc[k] for k in order]
for bp in s['buildPasses']:
    bp['componentRefs'] = order

# detail kinds from the taxonomy
KIND = {'thatch-courses': 'ridge', 'tower-cone-steps': 'contour', 'tower-crown': 'contour', 'dry-stone-courses': 'groove',
        'carved-gable': 'linework', 'thatch-dormer': 'contour', 'door-frame': 'contour', 'porch-rafter-ends': 'fastener',
        'porch-braces': 'contour', 'plank-roof': 'seam', 'tower-window': 'hole', 'side-gateway': 'hole', 'shelter-wall': 'contour',
        'shelter-fire': 'emissive', 'yard-props': 'contour'}
MAP = {'thatch-dormer': 'dormer-hood', 'porch-rafter-ends': 'porch-roof', 'porch-braces': 'porch-posts', 'plank-roof': 'porch-roof',
       'tower-crown': 'tower-crown', 'tower-window': 'tower-window', 'side-gateway': 'side-gateway', 'shelter-wall': 'shelter-wall'}
for dd in s['preSpecAssessment']['detailInventory']['details']:
    dd['kind'] = KIND[dd['id']]
    if dd['id'] in MAP: dd['mapsTo']['ref'] = MAP[dd['id']]
# every detail reaches a real field
feat_of = {}
for dd in s['preSpecAssessment']['detailInventory']['details']:
    t, ref = dd['mapsTo']['type'], dd['mapsTo']['ref']
    if t == 'component.localFeatures':
        c = allc[ref]
        if not any(f.get('id') == dd['id'] for f in c['localFeatures']):
            c['localFeatures'].append({'id': dd['id'], 'kind': dd['kind'], 'description': dd['description'], 'geometryEffect': {}})
    else:
        m = next(m for m in s['materials'] if m['id'] == ref)
        if not any(o.get('id') == dd['id'] for o in m['localOverrides']):
            m['localOverrides'].append({'id': dd['id'], 'region': dd['description'], 'effect': dd['kind']})

s['scores'] = {'object_isolation': 3, 'silhouette_readability': 3, 'depth_inference': 2, 'primitive_decomposition': 3, 'material_procedurality': 3, 'occlusion_risk': 1, 'interaction_fit': 2}
s['assumptions'] += [f'Resolved unknown: {u}' for u in s['preSpecAssessment']['unknownsToResolveBeforeImplementation']]
s['preSpecAssessment']['unknownsToResolveBeforeImplementation'] = []
s['lightingFromPhoto'] = [
    {'id': 'key', 'type': 'directional', 'role': 'key light', 'direction': [-0.6, 0.55, 0.6], 'intensity': 3.0, 'color': '#fff1dc', 'notes': 'Review scene key, like the reference studio key from front-left.'},
    {'id': 'fill', 'type': 'hemisphere', 'role': 'fill light', 'skyColor': '#bfd6f2', 'groundColor': '#3d4a26', 'intensity': 0.5},
    {'id': 'rim', 'type': 'directional', 'role': 'rim light', 'direction': [0.7, 0.4, -0.6], 'intensity': 0.8, 'color': '#c8d4ff'},
    {'id': 'exposure', 'type': 'tone mapping', 'notes': 'ACES filmic tone mapping, exposure 0.8 (project renderer); ground shadow from the key; ambient occlusion baked in materials.'},
]
json.dump(s, open(S, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('ok', len(s['componentTree']), 'components')
