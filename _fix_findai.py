p = r'c:\Users\himaska\Documents\Projects\Business_Projects\customer-service-agent\api\workflow_engine.py'
ls = open(p, encoding='utf-8').read().split('\n')
fix = {
    71: '    for node_id, node in (nodes or {}).items():',
    72: '        if not isinstance(node, dict):',
    73: '            continue',
    74: '        if node.get("typeId") != "ai-agent":',
    75: '            continue',
    76: '        if node.get("enabled") is False:',
    77: '            continue',
    78: '        return node_id, node',
    79: '    return None, None',
}
for i, v in fix.items():
    ls[i] = v
open(p, 'w', encoding='utf-8').write('\n'.join(ls))
print('normalized _find_ai_node')
