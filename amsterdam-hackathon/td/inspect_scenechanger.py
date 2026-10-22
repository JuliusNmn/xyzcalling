"""Read-only live-network audit; run from the TouchDesigner Textport."""
import json
from pathlib import Path


def inspect_network():
    nodes = op('/project1').findChildren()
    result = {'project': str(project.name), 'scenechangers': [], 'titles': [], 'scenes': []}
    for node in nodes:
        if node.family == 'COMP' and 'scenechang' in node.name.lower():
            parameters = []
            for par in node.customPars:
                parameters.append({
                    'name': par.name, 'label': par.label, 'style': par.style,
                    'value': str(par.eval()), 'expression': par.expr,
                    'menuNames': list(par.menuNames or []), 'menuLabels': list(par.menuLabels or []),
                })
            texts = []
            for child in node.findChildren():
                if child.family == 'DAT' and child.type == 'text':
                    texts.append({'path': child.path, 'text': child.text})
            result['scenechangers'].append({'path': node.path, 'parameters': parameters, 'texts': texts})
        if node.name == '01_The_Smooth_Criminal_On_Beat_Breaks_':
            result['scenes'].append(node.path)
        if node.name == 'null1' and node.family == 'DAT':
            rows = [[cell.val for cell in row] for row in node.rows()]
            if any('turntable1' in cell for row in rows for cell in row):
                result['titles'].append({'path': node.path, 'rows': rows})
    destination = Path(project.folder) / 'td' / 'scenechanger_live_audit.json'
    destination.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('SCENECHANGER AUDIT', destination, [entry['path'] for entry in result['scenechangers']])


inspect_network()
