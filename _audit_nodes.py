import re

base = r'c:\Users\himaska\Documents\Projects\Business_Projects\customer-service-agent'

# --- NODE_DEFINITIONS (frontend/components/nodes/definitions.ts) ---
src = open(base + '\\frontend\\components\\nodes\\definitions.ts', encoding='utf-8').read()
body = src.split('export const NODE_DEFINITIONS', 1)[1].split('export const CATEGORY_LABELS', 1)[0]

# Split into node blocks by the pattern:  key: {...} entries that open with typeId:
# Each node object starts "  'typeId-key': {\n    typeId: '...'"
# We'll find node boundaries by locating "{\n    typeId: '" positions.
node_blocks = re.split(r'(?=^\s{2}\'[\\w-]+\': \{\s*$)', body, flags=re.M)
hard = {}
for b in node_blocks:
    m = re.search(r"typeId: '([^']+)'", b)
    if not m:
        continue
    tid = m.group(1)
    name_m = re.search(r"name: '([^']+)'", b)
    fields = re.findall(r"key: '([^']+)'", b)
    hard[tid] = {'name': (name_m.group(1) if name_m else tid), 'fields': fields, 'field_count': len(fields)}

# --- FALLBACK_PIECES (useActivepiecesNodes.ts) ---
src2 = open(base + '\\frontend\\hooks\\useActivepiecesNodes.ts', encoding='utf-8').read()
fall_body = src2.split('const FALLBACK_PIECES', 1)[1].split('export function useActivepiecesNodes', 1)[0]
fallback = []
for m in re.finditer(r"\{(.*?)\}", fall_body, re.S):
    chunk = m.group(1)
    nm = re.search(r"name: '([^']+)'", chunk)
    ty = re.search(r"type: '([^']+)'", chunk)
    cat = re.search(r"category: '([^']+)'", chunk)
    if nm and ty:
        fallback.append({'name': nm.group(1), 'type': ty.group(1), 'category': cat.group(1) if cat else ''})

print('=== NODE_DEFINITIONS (hardcoded) count:', len(hard), '===')
for tid, v in hard.items():
    print('  %-16s %-22s fields=%d %s' % (tid, v['name'], v['field_count'], v['fields']))

print()
print('=== FALLBACK_PIECES count:', len(fallback), '===')
print('  type ids:', [f['type'] for f in fallback])

# --- Duplicates (same NAME, different typeId) between hardcoded and fallback ---
print()
print('=== DUPLICATES: node name present in BOTH NODE_DEFINITIONS and FALLBACK ===')
hard_by_name = {v['name'].strip().lower(): (tid, v) for tid, v in hard.items()}
for f in fallback:
    key = f['name'].strip().lower()
    if key in hard_by_name and f['type'] not in hard:
        ht, hv = hard_by_name[key]
        print('  FALLBACK "%s" (%s) duplicates NODE_DEFINITIONS "%s" (%s)' % (f['name'], f['type'], hv['name'], ht))
